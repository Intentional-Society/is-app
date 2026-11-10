// Tests for scripts/e2e-ci-deps.mjs, which cuts the lockfile down to what
// the e2e CI job imports.
//
// The script is CI tooling rather than server code; the functional-server
// Vitest project gives it the node environment it needs.
//
// The describes from "the repo's lockfile" on run against the repo's real
// files. e2e.yml installs only the script's output, so e2e code that loads a
// package outside E2E_CI_DEPS would pass locally (the full node_modules has
// it) and fail in CI; the import scan makes that a failing required check
// instead.

import { readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSourceFile,
  forEachChild,
  isCallExpression,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isStringLiteralLike,
  type Node,
  ScriptTarget,
  SyntaxKind,
} from "typescript";
import { describe, expect, it } from "vitest";

import { buildE2eCiManifest, E2E_CI_DEPS } from "../../../scripts/e2e-ci-deps.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..", "..");
const E2E_DIR = join(PROJECT_ROOT, "tests", "e2e");

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

type FoundImport = { specifier: string; typeOnly: boolean };

// Every module a source file loads, read from its syntax tree: import and
// export-from statements, `import()` and `require()`. `typeOnly` marks an
// `import type` / `export type` statement, which is erased before the code
// runs. A statement that mixes in a value (`import { type A, b }`) is not
// type-only.
const importsOf = (fileName: string, source: string): FoundImport[] => {
  const found: FoundImport[] = [];
  const visit = (node: Node): void => {
    if (isImportDeclaration(node) && isStringLiteralLike(node.moduleSpecifier)) {
      found.push({ specifier: node.moduleSpecifier.text, typeOnly: node.importClause?.isTypeOnly ?? false });
    } else if (isExportDeclaration(node) && node.moduleSpecifier && isStringLiteralLike(node.moduleSpecifier)) {
      found.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    } else if (
      isCallExpression(node) &&
      (node.expression.kind === SyntaxKind.ImportKeyword ||
        (isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const [argument] = node.arguments;
      // A computed specifier can't be checked, so it is reported as one
      // no package matches.
      found.push({
        specifier: argument && isStringLiteralLike(argument) ? argument.text : "<computed>",
        typeOnly: false,
      });
    }
    forEachChild(node, visit);
  };
  visit(createSourceFile(fileName, source, ScriptTarget.Latest));
  return found;
};

// Why the e2e CI install can't satisfy an import, or null when it can.
// The install holds E2E_CI_DEPS and the checkout holds the repo's files,
// so a relative import inside tests/e2e always resolves. One that leaves
// the directory reaches code whose own imports this scan doesn't follow,
// and the `@/` alias is such an import too; both are allowed only as type
// imports.
const unmetImport = (file: string, { specifier, typeOnly }: FoundImport, deps: readonly string[]): string | null => {
  if (typeOnly || isBuiltin(specifier)) return null;
  if (specifier.startsWith(".")) {
    return resolve(dirname(file), specifier).startsWith(E2E_DIR + sep) ? null : "leaves tests/e2e as a value import";
  }
  if (specifier.startsWith("@/")) return "leaves tests/e2e as a value import";
  // "@scope/name/sub" and "name/sub" both belong to their package.
  const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  return deps.includes(name) ? null : "is not in E2E_CI_DEPS";
};

describe("importsOf", () => {
  it("finds every way a file loads a module", () => {
    const source = [
      'import a from "pkg-a";',
      'import "pkg-b";',
      'export { c } from "pkg-c";',
      'const d = require("pkg-d");',
      'const e = await import("pkg-e");',
      "const f = await import(name);",
    ].join("\n");

    expect(importsOf("x.ts", source).map((i) => i.specifier)).toEqual([
      "pkg-a",
      "pkg-b",
      "pkg-c",
      "pkg-d",
      "pkg-e",
      "<computed>",
    ]);
  });

  it("marks only whole-statement type imports as type-only", () => {
    const source = [
      'import type { A } from "./a";',
      'export type { B } from "./b";',
      'import { type C, d } from "./c";',
      '// import type { E } from "./commented-out";',
      'import { e } from "./e";',
    ].join("\n");

    expect(importsOf("x.ts", source)).toEqual([
      { specifier: "./a", typeOnly: true },
      { specifier: "./b", typeOnly: true },
      { specifier: "./c", typeOnly: false },
      { specifier: "./e", typeOnly: false },
    ]);
  });
});

describe("unmetImport", () => {
  const spec = join(E2E_DIR, "helpers", "example.ts");
  const unmet = (specifier: string, typeOnly = false) =>
    unmetImport(spec, { specifier, typeOnly }, ["runner", "@scope/pkg"]);

  it("accepts listed packages, their subpaths, Node builtins and files inside tests/e2e", () => {
    for (const specifier of [
      "runner",
      "runner/sub",
      "@scope/pkg/sub",
      "node:path",
      "fs",
      "./sibling",
      "../other.spec",
    ]) {
      expect(unmet(specifier), specifier).toBeNull();
    }
  });

  it("rejects a package outside the list", () => {
    expect(unmet("zod")).toBe("is not in E2E_CI_DEPS");
    expect(unmet("@scope/other")).toBe("is not in E2E_CI_DEPS");
    expect(unmet("<computed>")).toBe("is not in E2E_CI_DEPS");
  });

  it("rejects a value import that leaves tests/e2e and accepts the same import as a type", () => {
    for (const specifier of ["../../../src/server/test-reset", "../../e2e-elsewhere/x", "@/lib/api"]) {
      expect(unmet(specifier), specifier).toBe("leaves tests/e2e as a value import");
      expect(unmet(specifier, true), specifier).toBeNull();
    }
  });
});

describe("the e2e code's imports", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
    });

  it("are all satisfied by the e2e CI install", () => {
    // playwright.config.ts sits at the repo root and loads tests/e2e
    // helpers; everything else the job runs is under tests/e2e.
    const files = [join(PROJECT_ROOT, "playwright.config.ts"), ...sourceFiles(E2E_DIR)];
    const unmet = files.flatMap((file) =>
      importsOf(file, readFileSync(file, "utf8")).flatMap((found) => {
        const reason = unmetImport(file, found, E2E_CI_DEPS);
        return reason ? [`${file}: "${found.specifier}" ${reason}`] : [];
      }),
    );
    expect(unmet).toEqual([]);
  });
});
