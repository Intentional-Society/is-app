#!/usr/bin/env node
// make-sandbox — build a disposable sandbox for a named fixture.
//
// Usage:
//   node scripts/skill-evals/make-sandbox.mjs --fixture <name> [--root <dir>] [--note <text>] [--json]
//   node scripts/skill-evals/make-sandbox.mjs --list
//
// Prints the sandbox path plus the exact PATH-shim + credential-scrub + cd lines to run
// (both PowerShell and POSIX), or the raw manifest JSON with --json. Sandboxes live under
// the OS temp dir by default; override with --root or SKILL_EVAL_SANDBOX_ROOT.

import { listFixtures } from "./lib/fixtures.mjs";
import { buildSandbox } from "./lib/sandbox.mjs";

const args = process.argv.slice(2);

if (has("--help") || has("-h")) {
  printHelp();
  process.exit(0);
}

if (has("--list")) {
  process.stdout.write(`${listFixtures().join("\n")}\n`);
  process.exit(0);
}

const fixture = value("--fixture") || firstPositional();
if (!fixture) {
  process.stderr.write("make-sandbox: no fixture given. Use --fixture <name> or --list.\n");
  process.exit(2);
}

let manifest;
try {
  manifest = buildSandbox({ fixture, root: value("--root"), note: value("--note") });
} catch (err) {
  process.stderr.write(`make-sandbox: ${err?.message ? err.message : err}\n`);
  process.exit(1);
}

if (has("--json")) {
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  process.exit(0);
}

const posix = (p) => p.replace(/\\/g, "/");
process.stdout.write(
  [
    `Sandbox ready: ${manifest.fixture}${manifest.dirty ? " (dirty tree)" : " (clean tree)"}`,
    `  sandbox : ${manifest.sandboxDir}`,
    `  repo    : ${manifest.repoDir}   (cd here — this is the executor's cwd)`,
    `  branch  : ${manifest.branch}`,
    `  marker  : ${manifest.marker}`,
    `  gh log  : ${manifest.ghCallLog}`,
    "",
    "Enter it (PowerShell):",
    `  . ${manifest.activate.ps1}`,
    "",
    "Enter it (Git Bash / macOS / Linux):",
    `  source ${posix(manifest.activate.sh)}`,
    "",
    "The stub gh is now the gh on PATH; GH_TOKEN/GITHUB_TOKEN are unset; GH_CONFIG_DIR is isolated.",
    "Tear down when done:",
    `  node scripts/skill-evals/teardown-sandbox.mjs ${manifest.sandboxDir}`,
    "",
  ].join("\n"),
);

function has(name) {
  return args.includes(name);
}
function value(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
function firstPositional() {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("-")) {
      if (["--fixture", "--root", "--note"].includes(a)) i++;
      continue;
    }
    return a;
  }
  return null;
}
function printHelp() {
  process.stdout.write(
    [
      "make-sandbox — build a disposable skill-eval sandbox.",
      "",
      "  --fixture <name>   fixture profile to build (or pass as a positional)",
      "  --list             list all fixture names and exit",
      "  --root <dir>       sandbox root (default: OS temp / $SKILL_EVAL_SANDBOX_ROOT)",
      "  --note <text>      note recorded in the sandbox marker",
      "  --json             print the manifest as JSON only",
      "  --help             this help",
      "",
    ].join("\n"),
  );
}
