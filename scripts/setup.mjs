#!/usr/bin/env node
// One-time setup for new developers. Safe to re-run — every step is idempotent.
// Extend by adding more step functions below and calling them from main().

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

function ensureLefthookInstalled() {
  // Wires lefthook's binary into .git/hooks. Re-running is a no-op.
  // Note: lefthook's own postinstall already does this during `npm install`
  // (skipped only when CI=true). Calling it here too is defense-in-depth +
  // explicit documentation of intent — see PR #307 discussion and #285 for
  // the broader "extra setup steps beyond npm install" policy question.
  const result = spawnSync("npx", ["lefthook", "install"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    console.error("  lefthook install failed — pre-commit formatting will not run");
    process.exit(1);
  }
}

function ensureGitBlameIgnoreConfig() {
  // Make local `git blame` honor .git-blame-ignore-revs so the baseline
  // format-pass commit doesn't pollute blame for every reformatted file.
  // GitHub honors the file automatically; this configures the dev's local
  // git. Idempotent — re-running overwrites with the same value.
  const result = spawnSync("git", ["config", "blame.ignoreRevsFile", ".git-blame-ignore-revs"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  if (result.status !== 0) {
    console.error("  git config blame.ignoreRevsFile failed (non-fatal)");
    return;
  }
  console.log("  git blame.ignoreRevsFile set");
}

function ensureLocalEnv() {
  const target = resolve(repoRoot, ".env.local");
  const source = resolve(repoRoot, ".env.local.example");
  if (existsSync(target)) {
    console.log("  .env.local already exists — leaving it alone");
    console.log(
      "  (if tests complain about missing keys, run `node scripts/check-env.mjs` to list them, or with `--fix` to append them)",
    );
    return;
  }
  if (!existsSync(source)) {
    console.error("  .env.local.example is missing — cannot create .env.local");
    process.exit(1);
  }
  copyFileSync(source, target);
  console.log("  created .env.local from .env.local.example");
}

function main() {
  console.log("Setting up is-app for local development...\n");

  console.log("1. Environment file");
  ensureLocalEnv();

  console.log("\n2. Git hooks (lefthook)");
  ensureLefthookInstalled();

  console.log("\n3. Git blame ignore-revs config");
  ensureGitBlameIgnoreConfig();

  console.log("\nDone. Next: run `npm run dev` (Docker Desktop must be running).");
}

main();
