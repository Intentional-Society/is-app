#!/usr/bin/env node
// Preflight: verify node_modules is current with package-lock.json.
//
// npm writes node_modules/.package-lock.json during install. If the repo
// lockfile is newer than that installed copy, local dependencies may be stale
// and package binaries can fail later with cryptic "not found" errors.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(import.meta.dirname, "..");

export function checkDependencyState(root = repoRoot) {
  const lockfile = resolve(root, "package-lock.json");
  const installedLock = resolve(root, "node_modules", ".package-lock.json");

  if (!existsSync(lockfile)) {
    return { ok: false, code: "missing-lockfile" };
  }

  if (!existsSync(installedLock)) {
    return { ok: false, code: "missing-installed-lock" };
  }

  const lockMtime = statSync(lockfile).mtimeMs;
  const installedMtime = statSync(installedLock).mtimeMs;

  // Git branch switches can refresh package-lock.json's mtime even when
  // dependencies already match; this may over-report, but fails safely.
  if (lockMtime > installedMtime) {
    return {
      ok: false,
      code: "stale-installed-lock",
      lockMtime,
      installedMtime,
    };
  }

  return { ok: true, lockMtime, installedMtime };
}

// Guard: exactly one sharp install in the tree.
//
// sharp ships libvips as a sibling package, so two sharp copies mean two
// libvips versions — and the loader searches only one of them. When that
// search misses, sharp silently falls back to its WebAssembly build, whose
// output Buffer undici mangles into a UTF-8 string (#469: corrupted avatars
// on Vercel, which held sharp at 0.34.5 for two months).
//
// A second copy appears whenever our sharp range stops overlapping Next's
// optional one: Next 16.2 wanted ^0.34.5 while we were pushed to 0.35.x,
// and today's overlap only holds because both sit in 0.35. A future Next
// moving to ^0.36 re-splits them, so this fails on the PR that causes it
// rather than silently in production. Two copies aren't always fatal —
// treat a failure as "come look", not "this is broken".
export function checkSingleSharp(root = repoRoot) {
  const lockfile = resolve(root, "package-lock.json");

  if (!existsSync(lockfile)) {
    return { ok: false, code: "missing-lockfile", copies: [] };
  }

  const packages = JSON.parse(readFileSync(lockfile, "utf8")).packages ?? {};
  const copies = Object.keys(packages).filter((p) => p === "node_modules/sharp" || p.endsWith("/node_modules/sharp"));

  if (copies.length === 1) {
    return { ok: true, copies };
  }

  return { ok: false, code: copies.length === 0 ? "sharp-absent" : "sharp-duplicated", copies };
}

function printFailure(result) {
  if (result.code === "sharp-duplicated") {
    console.error(`ensure-deps: package-lock.json resolves ${result.copies.length} copies of sharp.`);
    for (const copy of result.copies) {
      console.error(`    ${copy}`);
    }
    console.error("  Two copies mean two libvips versions, which risks the #469 avatar corruption.");
    console.error("  Fix: align our sharp range with Next's optional one so npm dedupes them.");
    return;
  }

  if (result.code === "sharp-absent") {
    console.error("ensure-deps: package-lock.json resolves no sharp install.");
    console.error("  Avatar encoding needs it. Fix: run `npm install sharp`.");
    return;
  }

  if (result.code === "missing-lockfile") {
    console.error("ensure-deps: package-lock.json is missing from the repo.");
    console.error("  This file should be committed so npm installs are reproducible.");
    return;
  }

  if (result.code === "missing-installed-lock") {
    console.error("ensure-deps: node_modules is missing or incomplete.");
    console.error("  Fix: run `npm install`.");
    return;
  }

  console.error("ensure-deps: package-lock.json is newer than node_modules.");
  console.error("  Dependencies may have changed since you last ran npm install.");
  console.error("  Fix: run `npm install`.");
}

function main() {
  for (const check of [checkDependencyState, checkSingleSharp]) {
    const result = check();
    if (!result.ok) {
      printFailure(result);
      process.exit(1);
    }
  }

  process.stdout.write("ensure-deps: node_modules is current.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
