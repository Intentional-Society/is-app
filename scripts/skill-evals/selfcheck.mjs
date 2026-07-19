#!/usr/bin/env node
// selfcheck — runs the Phase-2 safety checklist and prints a pass/fail report.
//
// Checks:
//   1. fixture-completeness  — a profile exists for every `fixture` referenced by a
//                              kind: execution eval, and every fixture builds.
//   2. default-deny          — an un-stubbed gh subcommand hard-fails (logged, no passthrough).
//   3. missing-marker        — the stub refuses with no marker; make-sandbox refuses inside the repo.
//   4. env-scrub             — env.json + activate scripts unset GH_TOKEN/GITHUB_TOKEN and isolate
//                              GH_CONFIG_DIR; a live call with the scrub applied records no creds.
//   5. teardown              — a built sandbox removes cleanly.
//   6. call-log-liveness     — a stubbed call leaves positive evidence in gh-calls.log.
//   7. stub-answers          — representative stubbed calls return the expected output.
//   8. pr7-sequencing        — pr create returns error-then-success across two calls.
//   9. wrapper-on-path       — the shell wrapper resolves as `gh` on PATH and reaches the stub.
//  10. zero-mutation-audit   — the real repo's HEAD/branches/status are unchanged by the run.
//
// Exit 0 iff every check passes.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { listFixtures } from "./lib/fixtures.mjs";
import { REPO_ROOT } from "./lib/paths.mjs";
import { buildSandbox, teardownSandbox } from "./lib/sandbox.mjs";

const results = [];
const built = [];
const before = repoState();

try {
  checkFixtureCompleteness();
  checkStubBehaviors();
  checkEnvScrub();
  checkTeardown();
  checkWrapperOnPath();
} finally {
  for (const dir of built) {
    try {
      teardownSandbox(dir);
    } catch {
      // best effort
    }
  }
}

checkZeroMutation(before);

report();

// ---------------------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------------------

function checkFixtureCompleteness() {
  const referenced = referencedFixtureNames();
  const available = new Set(listFixtures());
  const missing = [...referenced].filter((n) => !available.has(n));
  add(
    "fixture-completeness/names",
    missing.length === 0,
    missing.length === 0
      ? `${referenced.size} referenced names all have profiles`
      : `missing profiles: ${missing.join(", ")}`,
  );

  const buildFailures = [];
  for (const name of listFixtures()) {
    try {
      const m = buildSandbox({ fixture: name, note: "selfcheck" });
      built.push(m.sandboxDir);
      const ok =
        fs.existsSync(m.marker) && fs.existsSync(m.ghFixturePath) && fs.existsSync(path.join(m.repoDir, ".git"));
      if (!ok) buildFailures.push(`${name} (missing marker/gh-fixture/.git)`);
      // dirty flag matches expectation for the known dirty fixtures
    } catch (err) {
      buildFailures.push(`${name}: ${err?.message ? err.message : err}`);
    }
  }
  add(
    "fixture-completeness/build",
    buildFailures.length === 0,
    buildFailures.length === 0 ? `all ${listFixtures().length} fixtures built` : buildFailures.join("; "),
  );
}

function checkStubBehaviors() {
  // Use one representative sandbox with issues + collaborators + sequences.
  const m = buildSandbox({ fixture: "feature-no-pr-stale-reviewer-cache", note: "selfcheck-stub" });
  built.push(m.sandboxDir);
  const bin = m.binDir;
  const repo = m.repoDir;

  // default-deny
  const deny = runStub(bin, repo, ["repo", "delete", "--yes"]);
  const denyLogged = logContains(m.ghCallLog, "denied");
  add("default-deny/exit", deny.code === 64, `exit ${deny.code} on \`gh repo delete\` (expect 64)`);
  add("default-deny/logged", denyLogged, denyLogged ? "denial recorded in gh-calls.log" : "denial NOT logged");
  add("default-deny/no-passthrough", /not stubbed \(default-deny\)/.test(deny.stderr), "stub states no passthrough");

  // call-log liveness (positive evidence)
  runStub(bin, repo, ["auth", "status"]);
  const liveness = fs.readFileSync(m.ghCallLog, "utf8").trim().length > 0;
  add("call-log-liveness", liveness, liveness ? "gh-calls.log non-empty after a call" : "call log empty");

  // stub-answers: api collaborators --jq '.[].login'
  const collabs = runStub(bin, repo, [
    "api",
    "repos/Intentional-Society/is-app/collaborators",
    "--paginate",
    "--jq",
    ".[].login",
  ]);
  const hasHumans = /james-baker/.test(collabs.stdout) && /AlexisChen99/.test(collabs.stdout);
  add("stub-answers/collaborators", collabs.code === 0 && hasHumans, "collaborators --jq '.[].login' returns logins");

  // stub-answers: api user --jq '.login'
  const self = runStub(bin, repo, ["api", "user", "--jq", ".login"]);
  add(
    "stub-answers/user",
    self.code === 0 && self.stdout.trim() === "NorsemanSpiff",
    `api user --jq '.login' => ${self.stdout.trim()}`,
  );

  // stub-answers: api users/<login> --jq '.name // .login'
  const name = runStub(bin, repo, ["api", "users/james-baker", "--jq", ".name // .login"]);
  add(
    "stub-answers/users",
    name.code === 0 && name.stdout.trim() === "James Baker",
    `users/james-baker => ${name.stdout.trim()}`,
  );

  // pr7 sequencing: first pr create (formerteam) fails, second succeeds
  const first = runStub(bin, repo, ["pr", "create", "--reviewer", "formerteam", "--assignee", "@me"]);
  const second = runStub(bin, repo, ["pr", "create", "--reviewer", "james-baker", "--assignee", "@me"]);
  const seqOk =
    first.code !== 0 && /formerteam/.test(first.stderr) && second.code === 0 && /pull\/305/.test(second.stdout);
  add(
    "pr7-sequencing",
    seqOk,
    `pr create #1 exit ${first.code} (error), #2 exit ${second.code} (${second.stdout.trim()})`,
  );

  // missing-marker refusal: remove the marker, then invoke the stub
  fs.rmSync(m.marker, { force: true });
  const noMarker = runStub(bin, repo, ["auth", "status"]);
  add(
    "missing-marker/stub",
    noMarker.code === 66 && /No marker, no run/.test(noMarker.stderr),
    `stub exit ${noMarker.code} with marker removed (expect 66)`,
  );

  // missing-marker: make-sandbox refuses a root inside the repo
  let refusedInsideRepo = false;
  try {
    buildSandbox({ fixture: "feature-dirty-clean-payload", root: path.join(REPO_ROOT, "scratch-sandboxes") });
  } catch (err) {
    refusedInsideRepo = /inside the real repo/.test(String(err.message));
  }
  add(
    "missing-marker/inside-repo-refusal",
    refusedInsideRepo,
    refusedInsideRepo ? "make-sandbox refuses a root inside the repo" : "did NOT refuse an in-repo root",
  );
}

function checkEnvScrub() {
  const m = buildSandbox({ fixture: "feature-dirty-clean-payload", note: "selfcheck-scrub" });
  built.push(m.sandboxDir);
  const env = JSON.parse(fs.readFileSync(path.join(m.sandboxDir, "env.json"), "utf8"));
  const unsetsTokens = env.unset.includes("GH_TOKEN") && env.unset.includes("GITHUB_TOKEN");
  const isolatesConfig = env.set.GH_CONFIG_DIR?.startsWith(m.sandboxDir);
  add(
    "env-scrub/declared",
    unsetsTokens && isolatesConfig,
    "env.json unsets GH_TOKEN/GITHUB_TOKEN, GH_CONFIG_DIR inside sandbox",
  );

  const sh = fs.readFileSync(m.activate.sh, "utf8");
  const ps1 = fs.readFileSync(m.activate.ps1, "utf8");
  const shOk = /unset GH_TOKEN GITHUB_TOKEN/.test(sh) && /GH_CONFIG_DIR=/.test(sh);
  const ps1Ok =
    /Remove-Item Env:GH_TOKEN/.test(ps1) && /Remove-Item Env:GITHUB_TOKEN/.test(ps1) && /GH_CONFIG_DIR/.test(ps1);
  add("env-scrub/activate", shOk && ps1Ok, "activate.sh + activate.ps1 both scrub tokens and set GH_CONFIG_DIR");

  // Behavioral: a call WITH tokens in env records credsPresent true; a call with the scrub
  // applied records credsPresent false — proving the scrub takes effect.
  runStub(m.binDir, m.repoDir, ["auth", "status"], { GH_TOKEN: "gho_fake", GITHUB_TOKEN: "ghp_fake" });
  const scrubbedEnv = { ...process.env };
  for (const k of env.unset) delete scrubbedEnv[k];
  scrubbedEnv.GH_CONFIG_DIR = env.set.GH_CONFIG_DIR;
  runStub(m.binDir, m.repoDir, ["auth", "status"], scrubbedEnv, true);
  const lines = fs
    .readFileSync(m.ghCallLog, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const withCreds = lines.find((l) => l.credsPresent && l.credsPresent.GH_TOKEN === true);
  const withoutCreds = lines.find((l) => l.credsPresent && l.credsPresent.GH_TOKEN === false);
  add(
    "env-scrub/behavioral",
    Boolean(withCreds) && Boolean(withoutCreds),
    "call log shows creds present pre-scrub and absent post-scrub",
  );
}

function checkTeardown() {
  const m = buildSandbox({ fixture: "feature-open-pr-all-green", note: "selfcheck-teardown" });
  teardownSandbox(m.sandboxDir);
  add(
    "teardown",
    !fs.existsSync(m.sandboxDir),
    fs.existsSync(m.sandboxDir) ? "sandbox dir still present" : "sandbox removed cleanly",
  );
}

function checkWrapperOnPath() {
  const m = buildSandbox({ fixture: "feature-dirty-clean-payload", note: "selfcheck-wrapper" });
  built.push(m.sandboxDir);
  const delim = process.platform === "win32" ? ";" : ":";
  const res = spawnSync("gh", ["auth", "status"], {
    cwd: m.repoDir,
    env: { ...process.env, PATH: m.binDir + delim + process.env.PATH },
    shell: true,
    encoding: "utf8",
  });
  const grew = fs.readFileSync(m.ghCallLog, "utf8").trim().length > 0;
  const ok = res.status === 0 && grew;
  add(
    "wrapper-on-path",
    ok,
    ok
      ? `\`gh\` resolved to the stub via PATH (${process.platform})`
      : `wrapper did not reach the stub (status ${res.status})`,
  );
}

function checkZeroMutation(beforeState) {
  const after = repoState();
  const headOk = beforeState.head === after.head;
  const branchesOk = beforeState.branches === after.branches;
  const statusOk = beforeState.status === after.status;
  const fixtureBranches = [
    "fix-profile-redirect",
    "feature-dashboard",
    "feature-x",
    "feature-ready",
    "feature-pending",
    "docs-update",
    "add-widget",
    "add-report",
    "remove-legacy-id",
    "wire-up-dashboard",
  ];
  const leaked = fixtureBranches.filter((b) => new RegExp(`(^|\\n)\\s*\\*?\\s*${b}(\\n|$)`).test(after.branches));
  add("zero-mutation/head", headOk, headOk ? `real-repo HEAD unchanged (${after.head.slice(0, 10)})` : "HEAD CHANGED");
  add(
    "zero-mutation/branches",
    branchesOk && leaked.length === 0,
    leaked.length
      ? `fixture branches leaked into real repo: ${leaked.join(", ")}`
      : "no sandbox branches in the real repo",
  );
  add(
    "zero-mutation/status",
    statusOk,
    statusOk ? "real-repo `git status` unchanged by the run" : "real-repo working tree changed during the run",
  );
}

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------

function referencedFixtureNames() {
  const names = new Set();
  for (const skill of ["commit", "pr", "ship"]) {
    const p = path.join(REPO_ROOT, ".claude", "skills", skill, "evals", "evals.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const e of j.evals) if (e.kind === "execution" && e.fixture) names.add(e.fixture);
  }
  return names;
}

function runStub(binDir, repoDir, args, env, replaceEnv = false) {
  const stub = path.join(binDir, "gh-stub.mjs");
  const useEnv = replaceEnv ? env : { ...process.env, ...(env || {}) };
  const res = spawnSync("node", [stub, ...args], { cwd: repoDir, env: useEnv, encoding: "utf8" });
  return { code: res.status ?? -1, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function logContains(logPath, decision) {
  if (!fs.existsSync(logPath)) return false;
  return fs
    .readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .some((l) => {
      try {
        return JSON.parse(l).decision === decision;
      } catch {
        return false;
      }
    });
}

function repoState() {
  const g = (args) => {
    try {
      return execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" });
    } catch {
      return "";
    }
  };
  return {
    head: g(["rev-parse", "HEAD"]).trim(),
    branches: g(["branch", "--list"]),
    status: g(["status", "--porcelain"]),
  };
}

function add(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
}

function report() {
  let failed = 0;
  process.stdout.write(`\nskill-evals safety checklist\n${"=".repeat(60)}\n`);
  for (const r of results) {
    if (!r.pass) failed++;
    process.stdout.write(`${(r.pass ? "PASS " : "FAIL ") + r.name} — ${r.detail}\n`);
  }
  process.stdout.write(`${"=".repeat(60)}\n`);
  process.stdout.write(
    `${failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`} (${results.length} total)\n\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}
