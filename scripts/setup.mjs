#!/usr/bin/env node
// One-time setup for new developers. Safe to re-run — every step is idempotent.
// Extend by adding more step functions below and calling them from main().

import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

function ensureLocalEnv() {
  const target = resolve(repoRoot, ".env.local");
  const source = resolve(repoRoot, ".env.local.example");
  if (existsSync(target)) {
    console.log("  .env.local already exists — leaving it alone");
    console.log(
      "  (if tests complain about missing keys, run `node scripts/check-env.mjs --fix`)",
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

  console.log("1. (and only step currently) Environment file");
  ensureLocalEnv();

  console.log("\nDone. Next: run `npm run dev` (Docker Desktop must be running).");
}

main();
