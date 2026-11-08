// Tests for scripts/docs-only.mjs, the one definition of a docs-only change.
//
// The script is repo tooling rather than server code; the functional-server
// Vitest project gives it the node environment it needs.
//
// The isDocsOnly cases check our pathspec as git applies it, so each builds a
// throwaway git repo and never touches the real checkout. They cover our
// choices, not git's behaviour: the rename case fails if the script is ever
// rewritten to filter a `--name-only` list. parseArgs and the ci.yml drift
// check need no git.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { DOCS_ONLY_PATHS, isDocsOnly, parseArgs } from "../../../scripts/docs-only.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..", "..");

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Setup commits ignore the user's global signing and hooks config, which would
// otherwise prompt for a passphrase or run personal hooks in the temp repo.
function git(cwd: string, args: string[]) {
  execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=", ...args], {
    cwd,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function write(root: string, path: string, content = "content\n") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

// A repo with one commit holding a code file, a docs file and both root
// agent files.
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "is-app-docs-only-"));
  tempRoots.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "test"]);
  git(root, ["config", "core.autocrlf", "false"]);
  write(root, "src/app.ts", "one\ntwo\nthree\n");
  write(root, "docs/guide.md");
  write(root, "AGENTS.md");
  write(root, "CLAUDE.md");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  return root;
}

function commitAll(root: string) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "change"]);
}

describe("isDocsOnly", () => {
  it("is true when only docs/, AGENTS.md and CLAUDE.md change", () => {
    const root = makeRepo();
    write(root, "docs/guide.md", "edited\n");
    write(root, "docs/new/nested.md");
    write(root, "AGENTS.md", "edited\n");
    write(root, "CLAUDE.md", "edited\n");
    commitAll(root);
    expect(isDocsOnly(["HEAD~1", "HEAD"], { cwd: root })).toBe(true);
  });

  it("is false when a code path changes alongside docs", () => {
    const root = makeRepo();
    write(root, "docs/guide.md", "edited\n");
    write(root, "src/app.ts", "changed\n");
    commitAll(root);
    expect(isDocsOnly(["HEAD~1", "HEAD"], { cwd: root })).toBe(false);
  });

  it("counts a nested AGENTS.md or CLAUDE.md as code; only the root files are docs", () => {
    const root = makeRepo();
    write(root, "src/AGENTS.md");
    write(root, ".claude/skills/x/CLAUDE.md");
    commitAll(root);
    expect(isDocsOnly(["HEAD~1", "HEAD"], { cwd: root })).toBe(false);
  });

  it("counts a rename from code into docs/ as code (the src/ deletion still shows)", () => {
    const root = makeRepo();
    mkdirSync(join(root, "docs"), { recursive: true });
    git(root, ["mv", "src/app.ts", "docs/app.md"]);
    git(root, ["commit", "-q", "-m", "rename"]);
    expect(isDocsOnly(["HEAD~1", "HEAD"], { cwd: root })).toBe(false);
  });

  it("throws on a git error rather than calling it docs-only", () => {
    const root = makeRepo();
    expect(() => isDocsOnly(["no-such-ref", "HEAD"], { cwd: root })).toThrow();
  });
});

describe("parseArgs", () => {
  it("maps --staged to git diff --cached", () => {
    expect(parseArgs(["--staged"])).toEqual(["--cached"]);
  });

  it("compares a lone base against HEAD", () => {
    expect(parseArgs(["origin/main"])).toEqual(["origin/main", "HEAD"]);
  });

  it("passes a base and head through", () => {
    expect(parseArgs(["abc123", "def456"])).toEqual(["abc123", "def456"]);
  });

  it.each([
    ["no arguments", []],
    ["three refs", ["a", "b", "c"]],
    ["an unknown option", ["--cached"]],
    ["an option beside a ref", ["origin/main", "--stat"]],
    ["--staged with a ref", ["--staged", "origin/main"]],
  ])("rejects %s", (_label, args) => {
    expect(parseArgs(args)).toBeNull();
  });
});

describe("ci.yml's dorny/paths-filter matches DOCS_ONLY_PATHS", () => {
  it("lists `**` plus one negation per docs-only path", () => {
    const ci = readFileSync(resolve(PROJECT_ROOT, ".github/workflows/ci.yml"), "utf8");
    // The `code:` filter's list items, up to the first line that isn't one.
    const block = ci.match(/^\s*code:\s*\n((?:\s*- .+\n)+)/m);
    expect(block, "ci.yml has no `code:` filter list").not.toBeNull();
    const patterns = [...(block?.[1] ?? "").matchAll(/- '([^']+)'/g)].map((m) => m[1]);
    const expected = ["**", ...DOCS_ONLY_PATHS.map((p) => (p.endsWith("/") ? `!${p}**` : `!${p}`))];
    expect(patterns.sort()).toEqual(expected.sort());
  });
});
