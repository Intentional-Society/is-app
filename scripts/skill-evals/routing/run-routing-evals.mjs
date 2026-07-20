#!/usr/bin/env node
// Phase-8 routing session-runner.
//
// Runs the nine `kind: routing` evals as graded trigger RATES. For each query (commit-5
// expands to three sub-queries per the manifest), and for each of N repetitions:
//   1. build a disposable sandbox (make-sandbox) and copy the three team skills + the real
//      CLAUDE.md "AI Skills" section + settings.json in, so a fresh `claude -p` DISCOVERS
//      the skills naturally (routing is the thing under test — the skill must be found);
//   2. apply the scenario's setup files (opt-out / fresh delegation marker);
//   3. drive `claude -p` with the seeded turns (single-turn, or the multi-turn "assistant
//      offers → bare yes" R4 cases), streaming the transcript;
//   4. archive the raw evidence triad BEFORE teardown (Blake ruling 3), render the graded
//      turn to markdown, compute script-checkable observables;
//   5. grade the transcript against the eval's committed `expectations` via a headless
//      grader per agents/grader.md (with the R8 + AskUserQuestion headless adaptations);
//   6. tear the sandbox down.
// Results land in the standard `eval-<id>/<config>/run-<k>/grading.json` layout so
// `aggregate_benchmark.py` + the viewer work unchanged. A routing_summary.json reports
// per-eval TRIGGER RATES across the reps.
//
// Usage:
//   node scripts/skill-evals/routing/run-routing-evals.mjs [--only id,id] [--reps N]
//        [--model <m>] [--out <dir>] [--keep-sandboxes] [--list]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { archiveEvidence, buildSandbox, teardownSandbox } from "../lib/sandbox.mjs";
import { populateRoutingContext, REPO_ROOT } from "./lib/context.mjs";
import { runExecutor, runGrader } from "./lib/driver.mjs";
import { parseEvents, renderTurnMarkdown, routingObservables, splitTurns } from "./lib/transcript.mjs";
import { FRESH_DELEGATION, ROUTING_QUERIES } from "./routing-plan.mjs";

const NEGATIVE_CONTROLS = new Set(["commit-7", "commit-8", "ship-4", "ship-5"]);
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const has = (name) => args.includes(name);

if (has("--list")) {
  for (const q of ROUTING_QUERIES) {
    console.log(`${q.queryId.padEnd(22)} eval=${q.evalId.padEnd(9)} skill=${q.skill.padEnd(6)} fixture=${q.fixture}`);
  }
  process.exit(0);
}

const reps = Number(opt("--reps", "3"));
const model = opt("--model", "claude-sonnet-4-5");
const config = "with_skill";
const onlyIds = opt("--only", null)
  ?.split(",")
  .map((s) => s.trim());
const keepSandboxes = has("--keep-sandboxes");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outRoot = opt("--out", path.join(REPO_ROOT, ".claude", "skills", "routing-evals-workspace", stamp));

const queries = ROUTING_QUERIES.filter((q) => !onlyIds || onlyIds.includes(q.queryId));
if (!queries.length) {
  console.error(`No queries matched --only ${onlyIds}. Use --list.`);
  process.exit(2);
}

// Load committed expectations from the eval files (source of truth).
const evalCache = new Map();
function loadExpectations(q) {
  if (q.expectationsOverride) return q.expectationsOverride;
  if (!evalCache.has(q.skill)) {
    const file = path.join(REPO_ROOT, ".claude", "skills", q.skill, "evals", "evals.json");
    evalCache.set(q.skill, JSON.parse(fs.readFileSync(file, "utf8")));
  }
  const found = evalCache.get(q.skill).evals.find((e) => e.id === q.evalId);
  if (!found?.expectations?.length) throw new Error(`${q.evalId}: no expectations in eval file`);
  return found.expectations;
}

function buildInputJsonl(turns) {
  return `${turns
    .map((t) =>
      JSON.stringify({
        type: t.role,
        message: { role: t.role, content: [{ type: "text", text: t.text }] },
      }),
    )
    .join("\n")}\n`;
}

function applySetupFiles(repoDir, setupFiles) {
  for (const [rel, content] of Object.entries(setupFiles || {})) {
    const target = path.join(repoDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const body = content === FRESH_DELEGATION ? `pr\t${new Date().toISOString()}\n` : content;
    fs.writeFileSync(target, body);
  }
}

fs.mkdirSync(outRoot, { recursive: true });
console.log(`Routing runner: ${queries.length} queries × ${reps} reps, model=${model}`);
console.log(`Output: ${outRoot}\n`);

const summary = [];

for (const q of queries) {
  const expectations = loadExpectations(q);
  const expectTrigger = !NEGATIVE_CONTROLS.has(q.queryId);
  const evalDir = path.join(outRoot, `eval-${q.queryId}`, config);
  fs.mkdirSync(evalDir, { recursive: true });
  fs.writeFileSync(
    path.join(outRoot, `eval-${q.queryId}`, "eval_metadata.json"),
    JSON.stringify(
      { eval_id: q.queryId, source_eval: q.evalId, skill: q.skill, fixture: q.fixture, expectTrigger },
      null,
      2,
    ),
  );

  const perRep = [];
  for (let k = 1; k <= reps; k++) {
    const runDir = path.join(evalDir, `run-${k}`);
    const outputsDir = path.join(runDir, "outputs");
    fs.mkdirSync(outputsDir, { recursive: true });
    process.stdout.write(`  ${q.queryId} run-${k} … `);

    let manifest;
    try {
      manifest = buildSandbox({ fixture: q.fixture, note: `phase8-routing ${q.queryId} run-${k}` });
      populateRoutingContext(manifest.repoDir);
      applySetupFiles(manifest.repoDir, q.setupFiles);

      const inputJsonl = buildInputJsonl(q.turns);
      fs.writeFileSync(path.join(runDir, "input.jsonl"), inputJsonl);
      const rawOut = path.join(runDir, "raw.jsonl");
      const exec = await runExecutor({
        manifest,
        inputJsonl,
        outFile: rawOut,
        errFile: path.join(runDir, "executor.err"),
        model,
      });

      // Archive raw evidence BEFORE teardown; then compute observables + transcript.
      archiveEvidence(manifest.sandboxDir, outputsDir);
      const events = parseEvents(rawOut);
      const obs = routingObservables(events, {
        skill: q.skill,
        ghCallLog: path.join(outputsDir, "gh-calls.log"),
      });
      fs.writeFileSync(path.join(outputsDir, "observables.json"), JSON.stringify(obs, null, 2));
      const turns = splitTurns(events);
      fs.writeFileSync(
        path.join(runDir, "transcript.md"),
        [
          `# Routing eval ${q.queryId} — run ${k}`,
          `source eval: ${q.evalId} · skill: /${q.skill} · fixture: ${q.fixture} · model: ${model}`,
          exec.timedOut
            ? "\n> NOTE: executor hit the timeout and was killed; routing lands early, grading proceeds on the captured turn."
            : "",
          "",
          renderTurnMarkdown(turns[turns.length - 1]),
        ].join("\n"),
      );

      // Grade.
      const gradeStart = Date.now();
      const { grading, raw } = await runGrader({
        runDir,
        repoRoot: REPO_ROOT,
        expectations,
        graderHint: q.graderHint,
        model,
      });
      const graderSeconds = (Date.now() - gradeStart) / 1000;
      if (grading) {
        // The runner OWNS timing + metrics (real numbers) — overwrite the grader's
        // block, which may carry nulls (no timing.json existed) that crash the Python
        // aggregate. This also gives benchmark.json faithful wall-clock data.
        const executorSeconds = (obs.result?.duration_ms ?? 0) / 1000;
        grading.timing = {
          executor_duration_seconds: Number(executorSeconds.toFixed(1)),
          grader_duration_seconds: Number(graderSeconds.toFixed(1)),
          total_duration_seconds: Number((executorSeconds + graderSeconds).toFixed(1)),
        };
        grading.execution_metrics = {
          ...(grading.execution_metrics || {}),
          total_tool_calls: obs.numGradedTools,
          output_chars:
            Number(grading.execution_metrics?.output_chars) || fs.statSync(path.join(runDir, "transcript.md")).size,
          errors_encountered: Number(grading.execution_metrics?.errors_encountered) || 0,
        };
        // Coerce optional objects the grader sometimes emits as `null` — the Python
        // aggregate calls `.get()` on them (user_notes_summary) / iterates them.
        if (!grading.user_notes_summary || typeof grading.user_notes_summary !== "object") {
          grading.user_notes_summary = { uncertainties: [], needs_review: [], workarounds: [] };
        }
        if (!Array.isArray(grading.expectations)) grading.expectations = [];
        // Also mirror a sibling timing.json (the aggregate's secondary source).
        fs.writeFileSync(path.join(runDir, "timing.json"), JSON.stringify(grading.timing, null, 2));
        fs.writeFileSync(path.join(runDir, "grading.json"), JSON.stringify(grading, null, 2));
      } else {
        fs.writeFileSync(path.join(runDir, "grader-raw.txt"), raw);
      }
      const passRate = grading?.summary?.pass_rate ?? null;
      perRep.push({
        run: k,
        invoked: obs.invokedThisSkill,
        passRate,
        ghPrMerge: obs.ghLog.hasPrMerge,
        ghLive: obs.ghLog.live,
      });
      process.stdout.write(
        `invoked=${obs.invokedThisSkill} pass=${passRate == null ? "?" : passRate} ${exec.timedOut ? "(timeout)" : ""}\n`,
      );
    } catch (e) {
      process.stdout.write(`ERROR: ${e.message}\n`);
      fs.writeFileSync(path.join(runDir, "runner-error.txt"), String(e.stack || e));
      perRep.push({ run: k, error: String(e.message) });
    } finally {
      if (manifest && !keepSandboxes) {
        try {
          teardownSandbox(manifest.sandboxDir);
        } catch {
          /* leave for --all sweep */
        }
      }
    }
  }

  const invokedCount = perRep.filter((r) => r.invoked).length;
  const graded = perRep.filter((r) => typeof r.passRate === "number");
  const meanPass = graded.length ? graded.reduce((a, r) => a + r.passRate, 0) / graded.length : null;
  const evalSummary = {
    eval_id: q.queryId,
    source_eval: q.evalId,
    skill: q.skill,
    polarity: expectTrigger ? "should-fire" : "should-NOT-fire",
    reps,
    invocation_trigger_rate: reps ? invokedCount / reps : 0,
    mean_expectation_pass_rate: meanPass,
    runs: perRep,
  };
  summary.push(evalSummary);
}

fs.writeFileSync(
  path.join(outRoot, "routing_summary.json"),
  JSON.stringify({ model, reps, generatedAt: new Date().toISOString(), evals: summary }, null, 2),
);

// Aggregate into the standard benchmark.json/.md (best-effort; needs Python 3).
const agg = path.join(REPO_ROOT, ".claude", "skills", "skill-creator", "scripts", "aggregate_benchmark.py");
let aggregated = false;
for (const py of ["python3", "python"]) {
  try {
    execFileSync(py, [agg, outRoot, "--skill-name", "routing (commit/pr/ship)"], { stdio: "inherit" });
    aggregated = true;
    break;
  } catch {
    /* try the next interpreter name */
  }
}
if (!aggregated) {
  console.log(
    `\n(aggregate_benchmark.py not run — no python3/python on PATH, or it errored. Run it manually:\n  python3 "${agg}" "${outRoot}")`,
  );
}

console.log("\n=== Trigger-rate summary ===");
for (const e of summary) {
  console.log(
    `${e.eval_id.padEnd(22)} ${e.polarity.padEnd(14)} invoked ${(e.invocation_trigger_rate * 100).toFixed(0)}% · mean pass ${e.mean_expectation_pass_rate == null ? "n/a" : `${(e.mean_expectation_pass_rate * 100).toFixed(0)}%`}`,
  );
}
console.log(`\nArtifacts: ${outRoot}`);
