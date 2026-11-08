#!/usr/bin/env node
// A change is docs-only when every changed path is in DOCS_ONLY_PATHS.
// ci.yml's dorny/paths-filter `code:` list must match it; docs-only.test.ts
// enforces that.
//
// The pathspec goes on the `git diff` command because git applies it before
// rename detection: a src/ → docs/ rename still shows the src/ deletion.
// Filtering `git diff --name-only` output would see only the docs/ path.
//
// Node built-ins only: vercel-ignore-build.mjs imports this before
// `npm install`.
//
// CLI, from the repo root:
//   node scripts/docs-only.mjs --staged
//   node scripts/docs-only.mjs <base> [<head>]   head defaults to HEAD
// Prints `docs-only` and exits 0, or prints `code` and exits 1. A git error
// also exits 1, so the caller runs the gate or the build. An empty diff counts
// as docs-only; callers handle "nothing changed" first.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Root-relative paths a docs-only change may touch. A trailing `/` marks a directory. */
export const DOCS_ONLY_PATHS = ["docs/", "AGENTS.md", "CLAUDE.md"];

const NON_DOCS_PATHSPEC = [".", ...DOCS_ONLY_PATHS.map((p) => `:!${p}`)];

/**
 * True when `git diff <diffArgs>` touches only docs paths, e.g. with
 * `["--cached"]` or `["origin/main", "HEAD"]`. Throws on a git error.
 */
export function isDocsOnly(diffArgs, { cwd } = {}) {
  try {
    execFileSync("git", ["diff", "--quiet", ...diffArgs, "--", ...NON_DOCS_PATHSPEC], {
      cwd,
      stdio: ["ignore", "ignore", "inherit"],
    });
    return true;
  } catch (err) {
    if (err.status === 1) return false;
    throw err;
  }
}

/** CLI arguments → `git diff` arguments, or null for a usage error. */
export function parseArgs(args) {
  if (args.length === 1 && args[0] === "--staged") return ["--cached"];
  if (args.some((a) => a.startsWith("-"))) return null;
  if (args.length === 1) return [args[0], "HEAD"];
  if (args.length === 2) return [...args];
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const diffArgs = parseArgs(process.argv.slice(2));
  if (!diffArgs) {
    console.error("usage: node scripts/docs-only.mjs --staged | <base> [<head>]");
    process.exit(1);
  }
  let docsOnly = false;
  try {
    docsOnly = isDocsOnly(diffArgs);
  } catch {
    // git's own error is already on stderr; fall through to `code`.
  }
  console.log(docsOnly ? "docs-only" : "code");
  process.exit(docsOnly ? 0 : 1);
}
