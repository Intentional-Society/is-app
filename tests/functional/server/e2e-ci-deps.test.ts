// Tests for scripts/e2e-ci-deps.mjs, which cuts the lockfile down to what
// the e2e CI job imports.
//
// The script is CI tooling rather than server code; the functional-server
// Vitest project gives it the node environment it needs.
//
// The last two describes run against the repo's real files. e2e.yml installs
// only the script's output, so a spec importing a package outside
// E2E_CI_DEPS would pass locally (the full node_modules has it) and fail in
// CI; the import scan makes that a failing required check instead.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildE2eCiManifest, E2E_CI_DEPS } from "../../../scripts/e2e-ci-deps.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..", "..");

type LockEntry = {
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  dev?: boolean;
  devOptional?: boolean;
  peer?: boolean;
  optional?: boolean;
};
type Lock = { lockfileVersion: number; packages: Record<string, LockEntry> };

const lockOf = (packages: Record<string, LockEntry>): Lock => ({
  lockfileVersion: 3,
  packages: { "": { version: "1.0.0" }, ...packages },
});

describe("buildE2eCiManifest", () => {
  it("keeps a dependency and what it depends on, and drops the rest", () => {
    const { manifest, lock } = buildE2eCiManifest(
      lockOf({
        "node_modules/runner": { version: "1.2.3", dependencies: { core: "1.2.3" } },
        "node_modules/core": { version: "1.2.3" },
        "node_modules/unrelated": { version: "9.9.9" },
      }),
      ["runner"],
    );

    expect(manifest.dependencies).toEqual({ runner: "1.2.3" });
    expect(Object.keys(lock.packages).sort()).toEqual(["", "node_modules/core", "node_modules/runner"]);
  });

  it("resolves a nested copy before the root one, as Node does", () => {
    const { lock } = buildE2eCiManifest(
      lockOf({
        "node_modules/a": { version: "1.0.0", dependencies: { shared: "^2.0.0" } },
        "node_modules/a/node_modules/shared": { version: "2.0.0" },
        "node_modules/shared": { version: "1.0.0" },
      }),
      ["a"],
    );

    expect(Object.keys(lock.packages).sort()).toEqual(["", "node_modules/a", "node_modules/a/node_modules/shared"]);
  });

  it("resolves a scoped package's dependency from the root", () => {
    const { lock } = buildE2eCiManifest(
      lockOf({
        "node_modules/@scope/pkg": { version: "1.0.0", dependencies: { helper: "^1.0.0" } },
        "node_modules/helper": { version: "1.1.0" },
      }),
      ["@scope/pkg"],
    );

    expect(lock.packages["node_modules/helper"]).toEqual({ version: "1.1.0" });
  });

  it("keeps optional dependencies that are in the lockfile and skips ones that aren't", () => {
    const { lock } = buildE2eCiManifest(
      lockOf({
        "node_modules/native": {
          version: "1.0.0",
          optionalDependencies: { "native-linux": "1.0.0", "native-absent": "1.0.0" },
        },
        "node_modules/native-linux": { version: "1.0.0", optional: true },
      }),
      ["native"],
    );

    expect(lock.packages["node_modules/native-linux"]).toEqual({ version: "1.0.0", optional: true });
    expect(lock.packages["node_modules/native-absent"]).toBeUndefined();
  });

  it("drops the flags that place a package in the full tree's dev set", () => {
    const { lock } = buildE2eCiManifest(
      lockOf({ "node_modules/tool": { version: "1.0.0", dev: true, devOptional: true, peer: true } }),
      ["tool"],
    );

    expect(lock.packages["node_modules/tool"]).toEqual({ version: "1.0.0" });
  });

  it("throws when a requested package is not in the lockfile", () => {
    expect(() => buildE2eCiManifest(lockOf({}), ["missing"])).toThrow(/missing is not in package-lock.json/);
  });

  it("throws when a required dependency is not in the lockfile", () => {
    expect(() =>
      buildE2eCiManifest(lockOf({ "node_modules/a": { version: "1.0.0", dependencies: { gone: "1.0.0" } } }), ["a"]),
    ).toThrow(/needs gone/);
  });

  it("refuses a lockfile version it doesn't know", () => {
    expect(() => buildE2eCiManifest({ lockfileVersion: 2, packages: {} }, [])).toThrow(/lockfileVersion 3/);
  });
});

describe("the repo's lockfile", () => {
  const realLock = JSON.parse(readFileSync(join(PROJECT_ROOT, "package-lock.json"), "utf8")) as Lock;
  const { manifest, lock } = buildE2eCiManifest(realLock);

  it("pins each e2e dependency to the version the repo installs", () => {
    for (const name of E2E_CI_DEPS) {
      expect(manifest.dependencies[name]).toBe(realLock.packages[`node_modules/${name}`].version);
    }
  });

  it("copies every entry unchanged apart from the dev flags", () => {
    for (const [path, entry] of Object.entries(lock.packages as Record<string, LockEntry>)) {
      if (path === "") continue;
      const { dev: _dev, devOptional: _devOptional, peer: _peer, ...original } = realLock.packages[path];
      expect(entry).toEqual(original);
    }
  });

  it("is a small fraction of the full tree", () => {
    // Fails if a new e2e dependency drags a large subtree into the job.
    expect(Object.keys(lock.packages).length).toBeLessThan(60);
  });
});

describe("the e2e code's imports", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.name.endsWith(".ts") ? [path] : [];
    });

  it("name only packages in E2E_CI_DEPS", () => {
    const files = [join(PROJECT_ROOT, "playwright.config.ts"), ...sourceFiles(join(PROJECT_ROOT, "tests", "e2e"))];
    const outside: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
        const specifier = match[1] ?? match[2];
        if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
        // "@scope/name/sub" and "name/sub" both belong to their package.
        const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
        if (!E2E_CI_DEPS.includes(name)) outside.push(`${file}: ${specifier}`);
      }
    }
    expect(outside).toEqual([]);
  });
});
