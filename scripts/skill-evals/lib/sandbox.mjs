// Sandbox builder + teardown. Creates a throwaway git repo + a local bare "origin", applies
// a fixture profile, writes the marker, the gh stub (on a PATH-shimmed bin/), a fake npm
// test, and the credential-scrub/activation scripts. Everything lives under a temp/scratch
// root proven to be outside the real repo.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assertNodeEngine } from "./engine.mjs";
import { BASE_FILES, getFixture } from "./fixtures.mjs";
import { buildGhFixture } from "./gh-fixture.mjs";
import { assertOutsideRepo, HARNESS_DIR, MARKER_FILENAME, SANDBOX_PREFIX, sandboxRoot } from "./paths.mjs";

const GH_STUB_SRC = path.join(HARNESS_DIR, "gh-stub");
const FAKE_TEST_SRC = path.join(HARNESS_DIR, "fake-test.mjs");
const SCRUB_UNSET = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];

/**
 * Build a sandbox for a named fixture.
 * @param {{fixture:string, root?:string, note?:string}} opts
 * @returns {object} manifest
 */
export function buildSandbox({ fixture, root, note }) {
  assertNodeEngine();
  const profile = getFixture(fixture);

  // Create the base root private (0700) so a co-tenant on a shared POSIX tmpdir cannot read
  // into it, then create the per-sandbox dir with fs.mkdtempSync — the CodeQL-sanctioned
  // pattern for js/insecure-temporary-file: a unique, 0700, exclusively-created directory,
  // so every subsequent write lands somewhere unpredictable and unshared rather than in a
  // fixed, pre-creatable path. Windows ignores POSIX modes (no ACL handling, by design).
  const base = assertOutsideRepo(sandboxRoot(root));
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(base, 0o700);
  } catch {
    // Not the owner (pre-existing dir) or a non-POSIX FS — the mkdtemp dir below is still 0700.
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  // mkdtempSync appends random chars to the prefix and creates the dir 0700, exclusively.
  // The SANDBOX_PREFIX is preserved so teardownAll's prefix sweep still finds it.
  const sandboxDir = assertOutsideRepo(fs.mkdtempSync(path.join(base, `${SANDBOX_PREFIX + fixture}-${stamp}-`)));

  const originDir = path.join(sandboxDir, "origin.git");
  const repoDir = path.join(sandboxDir, "repo");
  const binDir = path.join(sandboxDir, "bin");
  const ghConfigDir = path.join(sandboxDir, "gh-config");
  // sandboxDir already exists (mkdtemp created it); create the children private too.
  for (const d of [repoDir, binDir, ghConfigDir]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });

  // --- git: bare origin + working repo baseline on main ------------------------------
  git(["init", "--bare", "-b", "main", originDir]);
  git(["init", "-b", "main", repoDir]);
  setLocalConfig(repoDir);

  writeFiles(repoDir, { ...BASE_FILES, ...(profile.baseFilesExtra || {}) });
  git(["-C", repoDir, "add", "-A"]);
  git(["-C", repoDir, "commit", "-m", "chore: sandbox baseline"]);
  git(["-C", repoDir, "remote", "add", "origin", pathToFileURL(originDir).href]);
  git(["-C", repoDir, "push", "origin", "main"]);

  // --- feature branch: commits + optional push point ----------------------------------
  git(["-C", repoDir, "switch", "-c", profile.branch]);
  const branchCommits = profile.branchCommits || [];
  for (let i = 0; i < branchCommits.length; i++) {
    const c = branchCommits[i];
    if (c.write) writeFiles(repoDir, c.write);
    for (const p of c.delete || []) fs.rmSync(path.join(repoDir, p), { force: true });
    git(["-C", repoDir, "add", "-A"]);
    git(["-C", repoDir, "commit", "-m", c.message]);
    if (profile.pushedBranchCommits != null && i + 1 === profile.pushedBranchCommits) {
      git(["-C", repoDir, "push", "-u", "origin", profile.branch]);
    }
  }
  if (profile.openPr && profile.pushedBranchCommits == null) {
    git(["-C", repoDir, "push", "-u", "origin", profile.branch]);
  }

  // --- uncommitted working-tree changes (dirty fixtures) ------------------------------
  if (profile.working?.write) writeFiles(repoDir, profile.working.write);
  for (const p of profile.working?.delete || []) fs.rmSync(path.join(repoDir, p), { force: true });

  // --- preseeded reviewer team cache (warm/stale fixtures) ----------------------------
  if (profile.teamCache) writeTeamCache(repoDir, profile);

  // --- harness runtime files (all gitignored inside the sandbox repo) -----------------
  writeMarker(repoDir, sandboxDir, fixture, note);
  fs.copyFileSync(FAKE_TEST_SRC, path.join(repoDir, ".skill-eval-fake-test.mjs"));
  installGhStub(binDir);

  const ghFixture = buildGhFixture(profile);
  fs.writeFileSync(path.join(sandboxDir, "gh-fixture.json"), `${JSON.stringify(ghFixture, null, 2)}\n`);
  fs.writeFileSync(path.join(sandboxDir, "gh-calls.log"), "");

  const env = {
    prependPath: binDir,
    unset: SCRUB_UNSET,
    set: { GH_CONFIG_DIR: ghConfigDir },
  };
  fs.writeFileSync(path.join(sandboxDir, "env.json"), `${JSON.stringify(env, null, 2)}\n`);
  writeActivateScripts(sandboxDir, { binDir, ghConfigDir, repoDir });

  const dirty = git(["-C", repoDir, "status", "--porcelain"]).trim().length > 0;
  const manifest = {
    fixture,
    summary: profile.summary,
    branch: profile.branch,
    dirty,
    sandboxDir,
    repoDir,
    originDir,
    binDir,
    ghConfigDir,
    ghFixturePath: path.join(sandboxDir, "gh-fixture.json"),
    ghCallLog: path.join(sandboxDir, "gh-calls.log"),
    marker: path.join(repoDir, MARKER_FILENAME),
    env,
    activate: {
      sh: path.join(sandboxDir, "activate.sh"),
      ps1: path.join(sandboxDir, "activate.ps1"),
    },
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(sandboxDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  // Root-level marker so an audit/teardown can identify the dir even if repo/ is removed.
  fs.writeFileSync(
    path.join(sandboxDir, MARKER_FILENAME),
    `${JSON.stringify({ fixture, createdAt: manifest.createdAt, note: note || null }, null, 2)}\n`,
  );
  return manifest;
}

/** Remove a sandbox directory, after proving it is a sandbox outside the repo. */
export function teardownSandbox(sandboxDir) {
  const resolved = assertOutsideRepo(sandboxDir);
  const looksLikeSandbox =
    fs.existsSync(path.join(resolved, MARKER_FILENAME)) ||
    fs.existsSync(path.join(resolved, "repo", MARKER_FILENAME)) ||
    fs.existsSync(path.join(resolved, "manifest.json"));
  if (!looksLikeSandbox) {
    throw new Error(`Refusing to remove ${resolved} — it does not look like a harness sandbox (no marker).`);
  }
  forceRemove(resolved);
  return resolved;
}

/**
 * Archive the raw evidence triad from a sandbox into destDir — call this BEFORE teardown.
 *
 * Captures the two OBJECTIVE triad legs (spec II.2e) as inspectable raw artifacts so a
 * grade is independently auditable and executor-independent (ruling 3, #511 gate-close
 * 2026-07-20 — binds all runs; the Phase-3 audit's F-A found these legs were never
 * preserved, leaving CLEAN verdicts resting on self-graded orchestrator prose):
 *   - `gh-calls.log`   — the primary grading evidence (what the skill asked GitHub to do).
 *   - `git-state.txt`  — a full raw dump of the sandbox repo + bare origin state.
 *   - `gh-stub-state.json` — the stub's durable state (incl. any merge records — item 1).
 * The transcript (the third leg) is the executor's own output, written to the eval
 * workspace separately; this function captures only the legs the harness itself owns.
 *
 * @param {string} sandboxDir  the sandbox to archive (must be outside the real repo).
 * @param {string} destDir     where to write the artifacts (an eval's `outputs/` dir).
 * @returns {{destDir:string, files:string[], gitState:boolean, ghCallLog:boolean}}
 */
export function archiveEvidence(sandboxDir, destDir) {
  const resolved = assertOutsideRepo(sandboxDir);
  if (!destDir) throw new Error("archiveEvidence: a destination dir is required.");
  fs.mkdirSync(destDir, { recursive: true });

  const repoDir = path.join(resolved, "repo");
  const originDir = path.join(resolved, "origin.git");
  const captured = [];

  // --- objective leg 1: the gh call log (copied verbatim) -----------------------------
  const ghLogSrc = path.join(resolved, "gh-calls.log");
  const ghCallLog = fs.existsSync(ghLogSrc);
  if (ghCallLog) {
    fs.copyFileSync(ghLogSrc, path.join(destDir, "gh-calls.log"));
    captured.push("gh-calls.log");
  }

  // --- stub durable state + provenance ------------------------------------------------
  for (const name of ["gh-stub-state.json", "gh-fixture.json", "manifest.json"]) {
    const src = path.join(resolved, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(destDir, name));
      captured.push(name);
    }
  }
  const markerSrc = path.join(resolved, MARKER_FILENAME);
  if (fs.existsSync(markerSrc)) {
    fs.copyFileSync(markerSrc, path.join(destDir, "sandbox-marker.json"));
    captured.push("sandbox-marker.json");
  }

  // --- objective leg 2: a raw, inspectable git-state dump -----------------------------
  const gitState = fs.existsSync(path.join(repoDir, ".git"));
  if (gitState) {
    const sections = [];
    const dump = (label, args) => sections.push(`### ${label}\n$ git ${args.join(" ")}\n${gitSafe(args)}`);
    dump("rev-parse HEAD", ["-C", repoDir, "rev-parse", "HEAD"]);
    dump("status --porcelain=v1 -b", ["-C", repoDir, "status", "--porcelain=v1", "-b"]);
    dump("log --oneline --all -n 50", ["-C", repoDir, "log", "--oneline", "--all", "-n", "50"]);
    dump("branch -avv", ["-C", repoDir, "branch", "-avv"]);
    dump("reflog -n 50", ["-C", repoDir, "reflog", "-n", "50"]);
    dump("diff (unstaged)", ["-C", repoDir, "diff"]);
    dump("diff --cached (staged)", ["-C", repoDir, "diff", "--cached"]);
    if (fs.existsSync(originDir)) {
      dump("origin(bare): log --oneline --all -n 50", [
        "--git-dir",
        originDir,
        "log",
        "--oneline",
        "--all",
        "-n",
        "50",
      ]);
      dump("origin(bare): branch --list", ["--git-dir", originDir, "branch", "--list"]);
    }
    fs.writeFileSync(path.join(destDir, "git-state.txt"), `${sections.join("\n\n")}\n`);
    captured.push("git-state.txt");
  }

  // --- archive manifest: provenance + what was captured -------------------------------
  const archiveManifest = {
    archivedAt: new Date().toISOString(),
    sandboxDir: resolved,
    destDir,
    captured,
    legs: {
      ghCallLog,
      gitState,
      transcript: "authored by the executor to the eval workspace — not a harness artifact",
    },
    note:
      "Raw evidence triad archived BEFORE teardown (spec II.2e; ruling 3, #511 gate-close). " +
      "gh-calls.log + git-state.txt are the two OBJECTIVE legs — inspectable independently of " +
      "any orchestrator narration, so the grade is executor-independent. Merge assertions are " +
      "corroborated against the transcript's tool-call record: the checked-in `ask` rule on " +
      "`gh pr merge *` can intercept a merge before the stub logs it, so an empty log is NOT " +
      "proof no merge was attempted (merge-discrimination rule, docs/strategy-skill-evals.md).",
  };
  fs.writeFileSync(path.join(destDir, "archive-manifest.json"), `${JSON.stringify(archiveManifest, null, 2)}\n`);
  captured.push("archive-manifest.json");

  return { destDir, files: captured, gitState, ghCallLog };
}

/** Remove every sandbox under the root. Returns the removed dirs. */
export function teardownAll(root) {
  const base = assertOutsideRepo(sandboxRoot(root));
  if (!fs.existsSync(base)) return [];
  const removed = [];
  for (const name of fs.readdirSync(base)) {
    // The prefix + location (under the sandbox root, outside the repo) is sufficient proof
    // the dir is ours — so --all also sweeps interrupted partials whose marker is gone.
    if (!name.startsWith(SANDBOX_PREFIX)) continue;
    const dir = assertOutsideRepo(path.join(base, name));
    try {
      forceRemove(dir);
      removed.push(dir);
    } catch {
      // Leave anything we genuinely can't remove (e.g. an open handle) for a later sweep.
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Like git(), but never throws — returns a bracketed error note instead (for the archive dump). */
function gitSafe(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
  } catch (err) {
    return `<git ${args.join(" ")} failed: ${err?.message ? err.message : err}>`;
  }
}

/** Remove a dir tree, tolerating Windows read-only git objects + transient locks. */
function forceRemove(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (err) {
    if (err && (err.code === "EPERM" || err.code === "EBUSY" || err.code === "ENOTEMPTY")) {
      clearReadOnly(dir);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    } else {
      throw err;
    }
  }
}

/** Recursively clear the read-only attribute so a subsequent rm can remove the tree. */
function clearReadOnly(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      fs.chmodSync(full, 0o666);
    } catch {
      // ignore
    }
    if (e.isDirectory()) clearReadOnly(full);
  }
}

function setLocalConfig(repoDir) {
  const cfg = [
    ["user.name", "Skill Eval Sandbox"],
    ["user.email", "sandbox@skill-evals.local"],
    ["commit.gpgsign", "false"],
    ["tag.gpgsign", "false"],
    ["core.autocrlf", "false"],
    ["core.hooksPath", path.join(repoDir, ".no-hooks")], // point hooks at a dir that does not exist
    ["gc.auto", "0"],
  ];
  for (const [k, v] of cfg) git(["-C", repoDir, "config", k, v]);
}

function writeFiles(repoDir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(repoDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function writeTeamCache(repoDir, profile) {
  const tc = profile.teamCache;
  const humansByLogin = {};
  for (const c of profile.gh?.collaborators || []) humansByLogin[c.login] = c.name ?? c.login;
  const displayNames = {};
  for (const login of tc.collaborators) displayNames[login] = humansByLogin[login] ?? login;
  Object.assign(displayNames, tc.extraDisplayNames || {});
  const refreshedAt = new Date(Date.now() - (tc.refreshedAtDaysAgo || 0) * 86400000).toISOString();
  const cache = {
    collaborators: tc.collaborators,
    displayNames,
    self: profile.gh?.self,
    refreshedAt,
  };
  const target = path.join(repoDir, ".claude", "skills", "pr", ".team-cache.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(cache, null, 2)}\n`);
}

function writeMarker(repoDir, sandboxDir, fixture, note) {
  const marker = {
    marker: "skill-eval-sandbox",
    fixture,
    sandboxDir,
    createdAt: new Date().toISOString(),
    note: note || null,
    warning: "Disposable eval sandbox. Everything here may be mutated freely. Never the real repo.",
  };
  fs.writeFileSync(path.join(repoDir, MARKER_FILENAME), `${JSON.stringify(marker, null, 2)}\n`);
}

function installGhStub(binDir) {
  for (const name of ["gh-stub.mjs", "gh", "gh.ps1", "gh.cmd"]) {
    const dest = path.join(binDir, name);
    fs.copyFileSync(path.join(GH_STUB_SRC, name), dest);
  }
  // Ensure the posix wrapper is executable regardless of the committed mode.
  try {
    fs.chmodSync(path.join(binDir, "gh"), 0o755);
    fs.chmodSync(path.join(binDir, "gh-stub.mjs"), 0o755);
  } catch {
    // chmod is a no-op / may throw on some Windows filesystems — safe to ignore.
  }
}

function writeActivateScripts(sandboxDir, { binDir, ghConfigDir, repoDir }) {
  const posix = (p) => p.replace(/\\/g, "/");
  // PATH entries specifically need MSYS/Git-Bash mount-point form (`/c/Users/...`),
  // not merely forward-slashed Windows form (`C:/Users/...`): bash's own command-search
  // over $PATH does not understand a drive-letter-colon segment the way `cd`/utilities
  // that take an explicit path argument do (those pass through to the Windows filesystem
  // APIs directly). A forward-slashed-but-still-drive-lettered PATH entry is silently
  // unresolvable, so `gh` falls through to the next PATH entry — which, on a dev machine
  // with the real GitHub CLI installed, is the real `gh` (found and confirmed empirically
  // during Phase 3 execution, 2026-07-20 — see docs/spec-skill-evals-baseline.md / #511).
  // Credential scrubbing (unset tokens + isolated GH_CONFIG_DIR) independently prevented
  // any authenticated reach to real GitHub even while this bug was live, but the stub's
  // call-log — and hence its liveness/evidence guarantees — could silently go dark for
  // any call this affected. Only the PATH line needs mount-point form; `cd` and
  // `GH_CONFIG_DIR` (read by Node, not resolved via bash's command search) both tolerate
  // the forward-slashed Windows form fine, verified empirically.
  const msysPath = (p) => {
    const forward = posix(p);
    const m = forward.match(/^([A-Za-z]):\/(.*)$/);
    return m ? `/${m[1].toLowerCase()}/${m[2]}` : forward;
  };
  const sh =
    "# Source this to enter the skill-eval sandbox (Git Bash / macOS / Linux):\n" +
    "#   source " +
    posix(path.join(sandboxDir, "activate.sh")) +
    "\n" +
    'export PATH="' +
    msysPath(binDir) +
    ':$PATH"\n' +
    "unset " +
    SCRUB_UNSET.join(" ") +
    "\n" +
    'export GH_CONFIG_DIR="' +
    posix(ghConfigDir) +
    '"\n' +
    'cd "' +
    posix(repoDir) +
    '"\n';
  fs.writeFileSync(path.join(sandboxDir, "activate.sh"), sh);

  const ps1 =
    "# Dot-source this to enter the skill-eval sandbox (PowerShell):\n" +
    "#   . " +
    path.join(sandboxDir, "activate.ps1") +
    "\n" +
    '$env:PATH = "' +
    binDir +
    ';" + $env:PATH\n' +
    SCRUB_UNSET.map((v) => `Remove-Item Env:${v} -ErrorAction SilentlyContinue`).join("\n") +
    "\n" +
    '$env:GH_CONFIG_DIR = "' +
    ghConfigDir +
    '"\n' +
    'Set-Location "' +
    repoDir +
    '"\n';
  fs.writeFileSync(path.join(sandboxDir, "activate.ps1"), ps1);
}
