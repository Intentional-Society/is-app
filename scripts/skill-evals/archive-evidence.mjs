#!/usr/bin/env node
// archive-evidence — copy a sandbox's raw evidence triad legs into an eval's workspace
// BEFORE teardown. Harness behavior, not prompt guidance (ruling 3, #511 gate-close
// 2026-07-20): every batch/executor run archives gh-calls.log + a raw git-state dump +
// the stub's durable state so the grade is independently auditable and executor-independent
// (the Phase-3 audit's F-A found these legs were never preserved).
//
// Usage:
//   node scripts/skill-evals/archive-evidence.mjs <sandboxDir> <destDir>
//   node scripts/skill-evals/archive-evidence.mjs --sandbox <dir> --dest <dir> [--json]
//
// Typically <destDir> is the eval's outputs dir, e.g.
//   .claude/skills/ship-workspace/iteration-1/eval-ship-2a/with_skill/run-1/outputs

import { archiveEvidence } from "./lib/sandbox.mjs";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    "archive-evidence <sandboxDir> <destDir>\n" +
      "  or: --sandbox <dir> --dest <dir> [--json]\n" +
      "Copies gh-calls.log + git-state.txt + gh-stub-state.json (the harness-owned raw\n" +
      "evidence-triad legs) into <destDir> before teardown. See docs/strategy-skill-evals.md.\n",
  );
  process.exit(0);
}

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const positionals = args.filter((a) => !a.startsWith("-"));
const sandboxDir = flag("--sandbox") ?? positionals[0];
const destDir = flag("--dest") ?? positionals[1];
const asJson = args.includes("--json");

if (!sandboxDir || !destDir) {
  process.stderr.write("archive-evidence: need a sandbox dir and a destination dir. See --help.\n");
  process.exit(2);
}

try {
  const result = archiveEvidence(sandboxDir, destDir);
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`Archived ${result.files.length} artifact(s) to ${result.destDir}\n`);
    for (const f of result.files) process.stdout.write(`  ${f}\n`);
    if (!result.ghCallLog) process.stdout.write("  WARNING: no gh-calls.log found in the sandbox.\n");
    if (!result.gitState) process.stdout.write("  WARNING: no git state captured (repo/.git missing).\n");
  }
} catch (err) {
  process.stderr.write(`archive-evidence: ${err?.message ? err.message : err}\n`);
  process.exit(1);
}
