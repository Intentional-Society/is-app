#!/usr/bin/env node
// Preflight: verify node_modules is current with package-lock.json.
//
// npm writes node_modules/.package-lock.json during install. If the repo
// lockfile is newer than that installed copy, local dependencies may be stale
// and package binaries can fail later with cryptic "not found" errors.

import { existsSync, statSync } from "node:fs";
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

function printFailure(result) {
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
  const result = checkDependencyState();
  if (result.ok) {
    process.stdout.write("ensure-deps: node_modules is current.\n");
    return;
  }

  printFailure(result);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
