#!/usr/bin/env node
// Writes a package.json and package-lock.json that hold only the packages
// the e2e CI job imports, cut from the repo's own lockfile.
//
// e2e.yml runs Playwright against a deployed preview, so it needs the test
// runner and the two packages the specs import, not the app's ~900
// dependencies. `npm ci` on this cut-down pair installs about ten packages
// in a few seconds. Every entry is copied from package-lock.json unchanged,
// so the versions and the integrity hashes npm verifies are the ones the
// repo pins; nothing is resolved afresh.
//
// Usage: node scripts/e2e-ci-deps.mjs <output-dir>
//
// A package a spec newly imports goes in E2E_CI_DEPS below.
// tests/functional/server/e2e-ci-deps.test.ts fails when one is missing.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(import.meta.dirname, "..");

// The packages tests/e2e/** and playwright.config.ts import by name.
export const E2E_CI_DEPS = ["@playwright/test", "dotenv", "sharp"];

// Finds the lockfile entry a package at `fromPath` gets when it requires
// `name`, the way Node resolves it: its own node_modules first, then each
// enclosing package's, up to the root.
const resolveDependency = (packages, fromPath, name) => {
  let base = fromPath;
  for (;;) {
    const candidate = base === "" ? `node_modules/${name}` : `${base}/node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (base === "") return null;
    const cut = base.lastIndexOf("/node_modules/");
    base = cut === -1 ? "" : base.slice(0, cut);
  }
};

// Builds the cut-down manifest and lockfile for `deps` from a parsed
// package-lock.json (lockfileVersion 3).
export const buildE2eCiManifest = (lock, deps = E2E_CI_DEPS) => {
  if (lock.lockfileVersion !== 3) {
    throw new Error(`e2e-ci-deps: expected lockfileVersion 3, found ${lock.lockfileVersion}`);
  }
  const packages = lock.packages;
  const included = new Map();
  const queue = [];
  /** @type {Record<string, string>} */
  const rootDependencies = {};

  for (const name of deps) {
    const path = resolveDependency(packages, "", name);
    if (!path) throw new Error(`e2e-ci-deps: ${name} is not in package-lock.json`);
    rootDependencies[name] = packages[path].version;
    queue.push(path);
  }

  while (queue.length > 0) {
    const path = queue.pop();
    if (included.has(path)) continue;
    const entry = packages[path];
    included.set(path, entry);
    // Optional dependencies stay in for every platform: npm skips the ones
    // that don't match the machine, and a lockfile missing them would send
    // it back to the registry to resolve them.
    const required = Object.keys(entry.dependencies ?? {});
    const optional = [...Object.keys(entry.optionalDependencies ?? {}), ...Object.keys(entry.peerDependencies ?? {})];
    for (const name of required) {
      const dependency = resolveDependency(packages, path, name);
      if (!dependency) throw new Error(`e2e-ci-deps: ${path} needs ${name}, which is not in package-lock.json`);
      queue.push(dependency);
    }
    for (const name of optional) {
      const dependency = resolveDependency(packages, path, name);
      if (dependency) queue.push(dependency);
    }
  }

  const manifest = {
    name: "is-app-e2e-ci-deps",
    version: "0.0.0",
    private: true,
    dependencies: rootDependencies,
  };
  /** @type {Record<string, unknown>} */
  const prunedPackages = { "": manifest };
  for (const path of [...included.keys()].sort()) {
    // dev/devOptional/peer describe the package's place in the full tree;
    // in this one every included package is a production dependency.
    const { dev: _dev, devOptional: _devOptional, peer: _peer, ...entry } = included.get(path);
    prunedPackages[path] = entry;
  }
  return {
    manifest,
    lock: {
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      requires: true,
      packages: prunedPackages,
    },
  };
};

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  const outDir = process.argv[2];
  if (!outDir) {
    process.stderr.write("usage: node scripts/e2e-ci-deps.mjs <output-dir>\n");
    process.exit(1);
  }
  const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
  const { manifest, lock: prunedLock } = buildE2eCiManifest(lock);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(outDir, "package-lock.json"), `${JSON.stringify(prunedLock, null, 2)}\n`);
  // The repo's npm policy (script lockdown, release-age quarantine) applies
  // to this install too.
  writeFileSync(join(outDir, ".npmrc"), readFileSync(join(repoRoot, ".npmrc")));
  const count = Object.keys(prunedLock.packages).length - 1;
  process.stdout.write(`e2e-ci-deps: wrote ${count} lockfile entries for ${E2E_CI_DEPS.join(", ")} to ${outDir}\n`);
}
