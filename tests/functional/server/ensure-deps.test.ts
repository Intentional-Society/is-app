// Tests for the pure helpers in scripts/ensure-deps.mjs.
//
// The script is a local workflow preflight rather than server code, but the
// functional-server Vitest project gives it the node environment it needs.
//
// checkSingleSharp is asserted against the repo's real lockfile at the bottom
// of this file. CI runs `npx biome ci .` and `npm run test:functional` rather
// than `npm run lint`, so the script's own CLI never executes there — that
// assertion is what makes the guard a required check rather than a local-only
// courtesy.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { checkDependencyState, checkSingleSharp } from "../../../scripts/ensure-deps.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..", "..");
const PACKAGE_JSON = resolve(PROJECT_ROOT, "package.json");

const tempRoots: string[] = [];

function makeTempRepo() {
  const root = mkdtempSync(join(tmpdir(), "is-app-ensure-deps-"));
  tempRoots.push(root);
  return root;
}

function writeLockPair(root: string, lockMtime: Date, installedMtime: Date) {
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  const nodeModules = join(root, "node_modules");
  mkdirSync(nodeModules);
  writeFileSync(join(nodeModules, ".package-lock.json"), "{}\n");
  utimesSync(join(root, "package-lock.json"), lockMtime, lockMtime);
  utimesSync(join(nodeModules, ".package-lock.json"), installedMtime, installedMtime);
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("checkDependencyState", () => {
  it("passes when the installed package lock is newer than the repo lockfile", () => {
    const root = makeTempRepo();
    writeLockPair(root, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:01Z"));

    expect(checkDependencyState(root)).toMatchObject({ ok: true });
  });

  it("passes when the installed package lock has the same mtime as the repo lockfile", () => {
    const root = makeTempRepo();
    const mtime = new Date("2026-01-01T00:00:00Z");
    writeLockPair(root, mtime, mtime);

    expect(checkDependencyState(root)).toMatchObject({ ok: true });
  });

  it("fails when node_modules is missing or incomplete", () => {
    const root = makeTempRepo();
    writeFileSync(join(root, "package-lock.json"), "{}\n");

    expect(checkDependencyState(root)).toEqual({ ok: false, code: "missing-installed-lock" });
  });

  it("fails when package-lock.json is missing", () => {
    const root = makeTempRepo();

    expect(checkDependencyState(root)).toEqual({ ok: false, code: "missing-lockfile" });
  });

  it("fails when package-lock.json is newer than node_modules/.package-lock.json", () => {
    const root = makeTempRepo();
    writeLockPair(root, new Date("2026-01-01T00:00:01Z"), new Date("2026-01-01T00:00:00Z"));

    expect(checkDependencyState(root)).toMatchObject({ ok: false, code: "stale-installed-lock" });
  });
});

describe("package script wiring", () => {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));

  it("runs before dev:db preflight work", () => {
    expect(packageJson.scripts["dev:db"]).toMatch(/^node scripts\/ensure-deps\.mjs && /);
  });

  it("runs before format so direct Biome writes catch stale dependencies first", () => {
    expect(packageJson.scripts.format).toMatch(/^node scripts\/ensure-deps\.mjs && /);
  });

  it("runs before lint so npm test catches stale dependencies before invoking Biome", () => {
    expect(packageJson.scripts.lint).toMatch(/^node scripts\/ensure-deps\.mjs && /);
    expect(packageJson.scripts.test).toMatch(/^npm run lint && /);
  });
});

describe("checkSingleSharp", () => {
  function writeLockfile(root: string, packages: Record<string, unknown>) {
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages }));
  }

  it("passes when one hoisted sharp serves the whole tree", () => {
    const root = makeTempRepo();
    writeLockfile(root, { "": {}, "node_modules/sharp": { version: "0.35.4" } });

    expect(checkSingleSharp(root)).toMatchObject({ ok: true });
  });

  it("fails when a nested copy sits alongside the hoisted one", () => {
    // The #469 shape: our range and Next's optional range stopped
    // overlapping, so npm installed a second sharp — and a second libvips.
    const root = makeTempRepo();
    writeLockfile(root, {
      "": {},
      "node_modules/sharp": { version: "0.34.5" },
      "node_modules/next/node_modules/sharp": { version: "0.35.3" },
    });

    const result = checkSingleSharp(root);

    expect(result).toMatchObject({ ok: false, code: "sharp-duplicated" });
    // Both paths are reported so the offending pair is obvious from CI output.
    expect(result.copies).toEqual(["node_modules/sharp", "node_modules/next/node_modules/sharp"]);
  });

  it("ignores lookalike package names", () => {
    const root = makeTempRepo();
    writeLockfile(root, {
      "": {},
      "node_modules/sharp": { version: "0.35.4" },
      "node_modules/sharp-cli": { version: "5.1.0" },
      "node_modules/@img/sharp-wasm32": { version: "0.35.4" },
    });

    expect(checkSingleSharp(root)).toMatchObject({ ok: true });
  });

  it("fails when no sharp resolves at all", () => {
    const root = makeTempRepo();
    writeLockfile(root, { "": {} });

    expect(checkSingleSharp(root)).toMatchObject({ ok: false, code: "sharp-absent" });
  });

  it("fails when package-lock.json is missing", () => {
    expect(checkSingleSharp(makeTempRepo())).toMatchObject({ ok: false, code: "missing-lockfile" });
  });
});

describe("this repo's lockfile", () => {
  it("resolves exactly one sharp", () => {
    expect(checkSingleSharp(PROJECT_ROOT)).toMatchObject({ ok: true });
  });
});
