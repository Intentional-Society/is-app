// Tests for the pure helper in scripts/ensure-deps.mjs.
//
// The script is a local workflow preflight rather than server code, but the
// functional-server Vitest project gives it the node environment it needs.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkDependencyState } from "../../../scripts/ensure-deps.mjs";

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
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  it("runs before dev:db preflight work", () => {
    expect(packageJson.scripts["dev:db"]).toMatch(/^node scripts\/ensure-deps\.mjs && /);
  });

  it("runs before lint so npm test catches stale dependencies before invoking Biome", () => {
    expect(packageJson.scripts.lint).toMatch(/^node scripts\/ensure-deps\.mjs && /);
    expect(packageJson.scripts.test).toMatch(/^npm run lint && /);
  });
});
