#!/usr/bin/env node
// teardown-sandbox — remove a sandbox (or all of them). Refuses anything that is not a
// harness sandbox outside the real repo.
//
// Usage:
//   node scripts/skill-evals/teardown-sandbox.mjs <sandboxDir> [--archive <destDir>]
//   node scripts/skill-evals/teardown-sandbox.mjs --all [--root <dir>]
//
// --archive <destDir> archives the raw evidence triad (gh-calls.log + git-state dump +
// stub state) into <destDir> BEFORE removing the sandbox, so archive-then-teardown is one
// atomic operation (ruling 3, #511 gate-close: archive before teardown, as harness
// behavior). See archive-evidence.mjs and docs/strategy-skill-evals.md.

import { archiveEvidence, teardownAll, teardownSandbox } from "./lib/sandbox.mjs";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    "teardown-sandbox <sandboxDir> [--archive <destDir>] | --all [--root <dir>]\n" +
      "Removes harness sandboxes; refuses non-sandbox paths. --archive captures the raw\n" +
      "evidence triad into <destDir> before removal.\n",
  );
  process.exit(0);
}

try {
  if (args.includes("--all")) {
    const i = args.indexOf("--root");
    const root = i >= 0 ? args[i + 1] : undefined;
    const removed = teardownAll(root);
    process.stdout.write(`Removed ${removed.length} sandbox(es).\n`);
    for (const r of removed) process.stdout.write(`  ${r}\n`);
  } else {
    const dir = args.find((a) => !a.startsWith("-"));
    if (!dir) {
      process.stderr.write("teardown-sandbox: pass a sandbox dir or --all.\n");
      process.exit(2);
    }
    const ai = args.indexOf("--archive");
    if (ai >= 0) {
      const dest = args[ai + 1];
      if (!dest) {
        process.stderr.write("teardown-sandbox: --archive needs a destination dir.\n");
        process.exit(2);
      }
      const result = archiveEvidence(dir, dest);
      process.stdout.write(`Archived ${result.files.length} artifact(s) to ${result.destDir} before teardown.\n`);
    }
    const removed = teardownSandbox(dir);
    process.stdout.write(`Removed ${removed}\n`);
  }
} catch (err) {
  process.stderr.write(`teardown-sandbox: ${err?.message ? err.message : err}\n`);
  process.exit(1);
}
