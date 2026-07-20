// The logging, DEFAULT-DENY `gh` stub.
//
// This file is copied into every sandbox's bin/ directory; the three thin wrappers
// (gh.ps1, gh.cmd, gh) in the same directory each exec `node gh-stub.mjs <args>`. Inside a
// sandbox the bin/ dir is prepended to PATH, so THIS is the `gh` that skill executors run.
//
// Contract (spec II.2b / II.2c):
//   * Answers ONLY the gh surface the three team SKILL.md files actually use, from
//     gh-fixture.json. Every answered and every refused call is appended to gh-calls.log
//     (the primary grading evidence).
//   * DEFAULT-DENY: any subcommand outside the stubbed surface hard-fails (non-zero exit,
//     logged) — it NEVER passes through to the real gh.
//   * "No marker, no run": refuses unless the sandbox marker is present.
//
// Stubbed surface (traced from .claude/skills/{commit,pr,ship}/SKILL.md):
//   auth status | issue view | pr view | pr list | pr create | pr checks | pr merge |
//   pr comment | run list | run watch |
//   api {user, users/<login>, repos/<owner>/<repo>/collaborators}
// (`pr list` is included as the read-only branch-PR-detection alias for `pr view`; both are
//  pure reads the skills need to decide "is there a PR for this branch?".)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX_DIR = path.dirname(BIN_DIR);
const MARKER = path.join(SANDBOX_DIR, "repo", ".skill-eval-sandbox");
const FIXTURE_PATH = path.join(SANDBOX_DIR, "gh-fixture.json");
const LOG_PATH = path.join(SANDBOX_DIR, "gh-calls.log");
const STATE_PATH = path.join(SANDBOX_DIR, "gh-stub-state.json");

const EXIT_DEFAULT_DENY = 64; // un-stubbed subcommand
const EXIT_NO_MARKER = 66; // sandbox marker missing
const EXIT_INTERNAL = 70; // stub bug

const rawArgv = process.argv.slice(2);
const argv = rawArgv.map(stripSurroundingQuotes);

function main() {
  try {
    if (!fs.existsSync(MARKER)) {
      logCall({ decision: "no-marker", exitCode: EXIT_NO_MARKER });
      stderr(
        "skill-eval gh stub: refusing to run — the sandbox marker (repo/.skill-eval-sandbox) is missing. " +
          "No marker, no run.",
      );
      process.exit(EXIT_NO_MARKER);
    }
    const fx = readJson(FIXTURE_PATH) || {};
    const code = dispatch(fx);
    process.exit(code);
  } catch (err) {
    logCall({ decision: "error", exitCode: EXIT_INTERNAL, error: String(err?.message ? err.message : err) });
    stderr(`skill-eval gh stub: internal error: ${err?.stack ? err.stack : err}`);
    process.exit(EXIT_INTERNAL);
  }
}

function dispatch(fx) {
  const [a0, a1] = argv;

  if (a0 === "auth" && a1 === "status") return handleAuthStatus(fx);
  if (a0 === "issue" && a1 === "view") return handleIssueView(fx);
  if (a0 === "pr" && a1 === "view") return handlePrView(fx);
  if (a0 === "pr" && a1 === "list") return handlePrList(fx);
  if (a0 === "pr" && a1 === "create") return handlePrCreate(fx);
  if (a0 === "pr" && a1 === "checks") return handlePrChecks(fx);
  if (a0 === "pr" && a1 === "merge") return handlePrMerge(fx);
  if (a0 === "pr" && a1 === "comment") return handlePrComment(fx);
  if (a0 === "run" && a1 === "list") return handleRunList(fx);
  if (a0 === "run" && a1 === "watch") return handleRunWatch(fx);
  if (a0 === "api") return handleApi(fx);

  // DEFAULT-DENY.
  logCall({ decision: "denied", exitCode: EXIT_DEFAULT_DENY });
  stderr(
    "skill-eval gh stub: subcommand not stubbed (default-deny): `gh " +
      rawArgv.join(" ") +
      "`.\nThe stub never passes through to the real gh. If this call is legitimately part " +
      "of a skill's flow, add it to the stub's traced surface; otherwise this is the eval " +
      "surfacing an un-modelled gh call.",
  );
  return EXIT_DEFAULT_DENY;
}

// ---------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------

function handleAuthStatus(fx) {
  const auth = fx.auth || { loggedIn: true, login: fx.self, host: "github.com" };
  if (auth.loggedIn) {
    // gh writes auth status to stderr.
    stderr(
      auth.host +
        "\n  ✓ Logged in to " +
        auth.host +
        " account " +
        auth.login +
        " (SANDBOX gh stub)\n  - Active account: true\n  ✓ Git operations protocol: https\n  ✓ Token: gho_" +
        "************************************",
    );
    logCall({ decision: "answered", exitCode: 0 });
    return 0;
  }
  stderr(`${auth.host}\n  X Not logged in to ${auth.host}. Run \`gh auth login\`.`);
  logCall({ decision: "answered", exitCode: 1 });
  return 1;
}

function handleIssueView(fx) {
  const number = firstPositional(2);
  const issue = fx.issues?.[String(number)];
  if (issue?.state !== "OPEN") {
    stderr(`no open issue found for #${number}`);
    logCall({ decision: "answered", exitCode: 1 });
    return 1;
  }
  emitObject(issue);
  logCall({ decision: "answered", exitCode: 0 });
  return 0;
}

function handlePrView(fx) {
  const number = firstPositional(2);
  let pr = null;
  if (number != null) {
    pr =
      fx.prs?.[String(number)] || (fx.branchPr && String(fx.branchPr.number) === String(number) ? fx.branchPr : null);
  } else {
    pr = fx.branchPr; // no number = the PR for the current branch
  }
  if (!pr) {
    stderr(number != null ? `no pull request found for #${number}` : "no pull requests found for the current branch");
    logCall({ decision: "answered", exitCode: 1 });
    return 1;
  }
  emitObject(pr);
  logCall({ decision: "answered", exitCode: 0 });
  return 0;
}

function handlePrList(fx) {
  const list = fx.branchPr ? [fx.branchPr] : [];
  emitArray(list);
  logCall({ decision: "answered", exitCode: 0 });
  return 0;
}

function handlePrCreate(fx) {
  const seq = takeSequenced(fx, "pr create");
  const resp = seq || fx.createPr || { ok: true, url: `https://github.com/${fx.owner}/${fx.repo}/pull/999` };
  if (resp.ok === false) {
    stderr(resp.stderr || "gh: pull request create failed");
    logCall({
      decision: "answered",
      exitCode: resp.exitCode || 1,
      reviewer: flagValue("--reviewer"),
      assignee: flagValue("--assignee"),
    });
    return resp.exitCode || 1;
  }
  stdout(resp.url);
  logCall({
    decision: "answered",
    exitCode: 0,
    reviewer: flagValue("--reviewer"),
    assignee: flagValue("--assignee"),
    prNumber: resp.number,
  });
  return 0;
}

function handlePrChecks(fx) {
  const checks = fx.checks || [];
  const lines = checks.map((c) => `${c.name}\t${c.bucket || "pass"}\t0s\t${c.link || ""}`);
  stdout(lines.join("\n"));
  const anyFail = checks.some((c) => c.bucket === "fail");
  const anyPending = checks.some((c) => c.bucket === "pending");
  const exitCode = anyFail ? 1 : anyPending ? 8 : 0; // gh: 0 pass, 8 pending, 1 fail
  logCall({ decision: "answered", exitCode, watch: hasFlag("--watch") });
  return exitCode;
}

function handlePrMerge(_fx) {
  const number = firstPositional(2);
  stdout(`✓ Merged pull request #${number ?? "?"} (SANDBOX STUB — no real merge)`);
  // Durable merge record — an inspectable side effect (in gh-stub-state.json) that survives
  // into the archived sandbox state, independent of the transcript, corroborating a real
  // merge wherever this handler was actually reached. It never mutates the sandbox git tree,
  // so the skill's own post-merge tidy (`git branch -d <feature>`) is unaffected.
  //
  // CAVEAT (item 1 / F-B, #511): the checked-in `ask` rule on `gh pr merge *` usually
  // intercepts the command at the Claude Code permission layer BEFORE the stub runs, so in a
  // Claude Code eval session this handler — and therefore this record and the log entry
  // below — is often never reached even for a genuine merge. An empty log/state is therefore
  // NOT proof no merge was attempted. The authoritative merge signal for grading is the
  // TRANSCRIPT's tool-call record (a `gh pr merge` attempt appears there whether or not the
  // ask-rule lets it through). See the merge-discrimination rule in docs/strategy-skill-evals.md.
  recordMerge({
    prNumber: number,
    merge: hasFlag("--merge"),
    deleteBranch: hasFlag("--delete-branch"),
    squash: hasFlag("--squash"),
  });
  logCall({
    decision: "answered",
    exitCode: 0,
    merge: hasFlag("--merge"),
    deleteBranch: hasFlag("--delete-branch"),
    squash: hasFlag("--squash"),
    prNumber: number,
  });
  return 0;
}

function recordMerge(entry) {
  const state = readJson(STATE_PATH) || {};
  const merges = state.merges || [];
  merges.push({ ts: new Date().toISOString(), argv: rawArgv, ...entry });
  state.merges = merges;
  writeJson(STATE_PATH, state);
}

function handlePrComment(fx) {
  const number = firstPositional(2);
  const url = `https://github.com/${fx.owner}/${fx.repo}/pull/${number}#issuecomment-1000000000`;
  stdout(url);
  logCall({
    decision: "answered",
    exitCode: 0,
    prNumber: number,
    hasBody: hasFlag("--body") || hasFlag("--body-file"),
  });
  return 0;
}

function handleRunList(fx) {
  const runs = fx.runs || [];
  if (hasFlag("--json")) {
    emitArray(runs);
  } else {
    stdout(runs.map((r) => `${r.status}\t${r.conclusion}\t${r.name}\t${r.databaseId}\t${r.url}`).join("\n"));
  }
  logCall({ decision: "answered", exitCode: 0, branch: flagValue("--branch"), commit: flagValue("--commit") });
  return 0;
}

function handleRunWatch(fx) {
  const id = firstPositional(2);
  const run = (fx.runs || []).find((r) => String(r.databaseId) === String(id)) || (fx.runs || [])[0];
  if (run) {
    stdout(`${run.name} ${run.status} (${run.conclusion})`);
  } else {
    stdout(`run ${id} completed`);
  }
  logCall({ decision: "answered", exitCode: 0, runId: id });
  return 0;
}

function handleApi(fx) {
  const endpoint = firstPositional(1);
  const jq = flagValue("--jq");
  if (endpoint === "user") {
    const self = fx.self;
    if (jq === ".login") stdout(self);
    else emitObject({ login: self });
    logCall({ decision: "answered", exitCode: 0, api: "user" });
    return 0;
  }
  const usersMatch = /^users\/(.+)$/.exec(endpoint || "");
  if (usersMatch) {
    const login = usersMatch[1];
    const name = fx.displayNames?.[login] ?? login;
    if (jq === ".name // .login") stdout(name);
    else emitObject({ login, name });
    logCall({ decision: "answered", exitCode: 0, api: `users/${login}` });
    return 0;
  }
  if (/repos\/[^/]+\/[^/]+\/collaborators$/.test(endpoint || "")) {
    const collaborators = fx.collaborators || [];
    if (jq === ".[].login") stdout(collaborators.map((c) => c.login).join("\n"));
    else emitArray(collaborators);
    logCall({ decision: "answered", exitCode: 0, api: "collaborators" });
    return 0;
  }
  // Unknown api endpoint -> default-deny.
  logCall({ decision: "denied", exitCode: EXIT_DEFAULT_DENY, api: endpoint });
  stderr(`skill-eval gh stub: api endpoint not stubbed (default-deny): \`gh ${rawArgv.join(" ")}\`.`);
  return EXIT_DEFAULT_DENY;
}

// ---------------------------------------------------------------------------------------
// Emit helpers — honor --json / --jq the way the traced skills consume output.
// ---------------------------------------------------------------------------------------

function emitObject(obj) {
  stdout(JSON.stringify(obj));
}
function emitArray(arr) {
  stdout(JSON.stringify(arr));
}

// ---------------------------------------------------------------------------------------
// Per-call sequencing (pr-7): return responses[index] and advance a persistent counter.
// ---------------------------------------------------------------------------------------

function takeSequenced(fx, key) {
  const seq = fx.sequences?.[key];
  if (!seq || seq.length === 0) return null;
  const state = readJson(STATE_PATH) || {};
  const counts = state.counts || {};
  const idx = counts[key] || 0;
  const resp = seq[Math.min(idx, seq.length - 1)];
  counts[key] = idx + 1;
  state.counts = counts;
  writeJson(STATE_PATH, state);
  return resp;
}

// ---------------------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------------------

function stripSurroundingQuotes(s) {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return s.slice(1, -1);
  }
  return s;
}

/** The Nth positional (non-flag) argument, 0-indexed over positionals. */
function positionals() {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("-")) {
      // Skip a following value for flags that take one (best-effort; harmless if wrong).
      if (FLAGS_WITH_VALUE.has(a) && i + 1 < argv.length && !argv[i + 1].startsWith("-")) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

const FLAGS_WITH_VALUE = new Set([
  "--jq",
  "--json",
  "--reviewer",
  "--assignee",
  "--body",
  "--body-file",
  "--limit",
  "--branch",
  "--commit",
  "--title",
  "--head",
  "--base",
  "-F",
  "-f",
  "-H",
]);

/** Positional at absolute index `n` (counting the subcommand tokens too). */
function firstPositional(n) {
  const ps = positionals();
  return ps[n] ?? null;
}

function hasFlag(name) {
  return argv.some((a) => a === name || a.startsWith(`${name}=`));
}

function flagValue(name) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === name) return argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[i + 1] : "";
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------------------

function stdout(s) {
  process.stdout.write(`${s ?? ""}\n`);
}
function stderr(s) {
  process.stderr.write(`${s ?? ""}\n`);
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
function writeJson(p, obj) {
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
}

function logCall(extra) {
  const entry = {
    ts: new Date().toISOString(),
    argv: rawArgv,
    cwd: process.cwd(),
    sub: rawArgv.slice(0, 2).join(" "),
    credsPresent: {
      GH_TOKEN: Boolean(process.env.GH_TOKEN),
      GITHUB_TOKEN: Boolean(process.env.GITHUB_TOKEN),
    },
    ghConfigDir: process.env.GH_CONFIG_DIR || null,
    ...extra,
  };
  try {
    fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
  } catch {
    // If we cannot log (e.g. sandbox torn down mid-call) fail closed rather than silently.
    stderr(`skill-eval gh stub: could not append to call log at ${LOG_PATH}`);
  }
}

// Run last so all top-level const declarations (FLAGS_WITH_VALUE, etc.) are initialized.
main();
