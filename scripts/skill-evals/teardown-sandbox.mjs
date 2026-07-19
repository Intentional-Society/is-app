#!/usr/bin/env node
// teardown-sandbox — remove a sandbox (or all of them). Refuses anything that is not a
// harness sandbox outside the real repo.
//
// Usage:
//   node scripts/skill-evals/teardown-sandbox.mjs <sandboxDir>
//   node scripts/skill-evals/teardown-sandbox.mjs --all [--root <dir>]

import { teardownAll, teardownSandbox } from "./lib/sandbox.mjs";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    "teardown-sandbox <sandboxDir> | --all [--root <dir>]\nRemoves harness sandboxes; refuses non-sandbox paths.\n",
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
    const removed = teardownSandbox(dir);
    process.stdout.write(`Removed ${removed}\n`);
  }
} catch (err) {
  process.stderr.write(`teardown-sandbox: ${err?.message ? err.message : err}\n`);
  process.exit(1);
}
