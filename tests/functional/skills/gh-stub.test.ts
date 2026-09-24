import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getFixture } from "../../../scripts/skill-evals/lib/fixtures.mjs";
import { buildGhFixture } from "../../../scripts/skill-evals/lib/gh-fixture.mjs";

// Unit coverage for the skill-eval `gh` stub's read-only conversation routes (#580): the
// pull-request review-comments REST endpoint and the review-threads GraphQL query that
// `/ship` step 10 reads right before the merge. Each test lays out the minimal directory
// shape the stub expects (bin/gh-stub.mjs, repo/.skill-eval-sandbox, gh-fixture.json) in a
// temp dir — no git, no make-sandbox, no network — and runs the stub as a child process.

const STUB_SOURCE = path.resolve("scripts/skill-evals/gh-stub/gh-stub.mjs");
const REVIEW_THREADS_QUERY =
  "query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved path comments(first:1){nodes{author{login} createdAt body}}}}}}}";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function layout(fixture: object) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-stub-test-"));
  made.push(dir);
  fs.mkdirSync(path.join(dir, "bin"));
  fs.mkdirSync(path.join(dir, "repo"));
  fs.copyFileSync(STUB_SOURCE, path.join(dir, "bin", "gh-stub.mjs"));
  fs.writeFileSync(path.join(dir, "repo", ".skill-eval-sandbox"), "");
  fs.writeFileSync(path.join(dir, "gh-fixture.json"), JSON.stringify(fixture));
  return dir;
}

function gh(dir: string, args: string[]) {
  const res = spawnSync(process.execPath, [path.join(dir, "bin", "gh-stub.mjs"), ...args], {
    cwd: path.join(dir, "repo"),
    encoding: "utf8",
  });
  const logPath = path.join(dir, "gh-calls.log");
  const log = fs.existsSync(logPath)
    ? fs
        .readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, log };
}

const BASE = { owner: "Intentional-Society", repo: "is-app", self: "NorsemanSpiff" };
const INLINE = {
  id: 1,
  user: { login: "AlexisChen99" },
  created_at: "2026-09-20T12:30:00Z",
  path: "src/app/x.ts",
  body: "nit",
};
const THREAD = {
  isResolved: false,
  path: "src/app/x.ts",
  comments: { nodes: [{ author: { login: "AlexisChen99" }, createdAt: "2026-09-20T12:30:00Z", body: "nit" }] },
};

describe("gh stub — api repos/<owner>/<repo>/pulls/<N>/comments", () => {
  it("answers with the fixture's pullComments and logs the call as answered", () => {
    const dir = layout({ ...BASE, pullComments: [INLINE] });
    const out = gh(dir, ["api", "--paginate", "repos/Intentional-Society/is-app/pulls/223/comments"]);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual([INLINE]);
    expect(out.log.at(-1)).toMatchObject({ decision: "answered", exitCode: 0, api: "pulls/comments" });
  });

  it("answers an empty array when the fixture seeds no inline comments", () => {
    const dir = layout(BASE);
    const out = gh(dir, ["api", "repos/Intentional-Society/is-app/pulls/223/comments"]);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual([]);
  });

  it("still default-denies a neighbouring endpoint (pulls/<N>/reviews)", () => {
    const dir = layout(BASE);
    const out = gh(dir, ["api", "repos/Intentional-Society/is-app/pulls/223/reviews"]);
    expect(out.code).toBe(64);
    expect(out.log.at(-1)).toMatchObject({ decision: "denied", exitCode: 64 });
  });
  it("default-denies a write to the same endpoint (-X POST / --method POST): the route is read-only", () => {
    const dir = layout({ ...BASE, pullComments: [INLINE] });
    for (const args of [
      ["api", "repos/Intentional-Society/is-app/pulls/223/comments", "-X", "POST", "-f", "body=hi"],
      ["api", "--method", "POST", "repos/Intentional-Society/is-app/pulls/223/comments", "-f", "body=hi"],
    ]) {
      const out = gh(dir, args);
      expect(out.code).toBe(64);
      expect(out.stdout).toBe("");
      expect(out.log.at(-1)).toMatchObject({ decision: "denied", exitCode: 64 });
    }
    // and an explicit GET still reads
    const read = gh(dir, ["api", "-X", "GET", "repos/Intentional-Society/is-app/pulls/223/comments"]);
    expect(read.code).toBe(0);
    expect(JSON.parse(read.stdout)).toHaveLength(1);
  });
});

describe("gh stub — api graphql (reviewThreads)", () => {
  it("answers a reviewThreads query from the fixture, one page, and logs it as answered", () => {
    const dir = layout({ ...BASE, reviewThreads: [THREAD] });
    const out = gh(dir, [
      "api",
      "graphql",
      "-F",
      "owner=Intentional-Society",
      "-F",
      "repo=is-app",
      "-F",
      "n=223",
      "-f",
      `query=${REVIEW_THREADS_QUERY}`,
    ]);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual({
      data: {
        repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [THREAD] } } },
      },
    });
    expect(out.log.at(-1)).toMatchObject({ decision: "answered", exitCode: 0 });
  });

  it("answers no nodes when the fixture seeds no review threads", () => {
    const dir = layout(BASE);
    const out = gh(dir, ["api", "graphql", "-f", `query=${REVIEW_THREADS_QUERY}`]);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout).data.repository.pullRequest.reviewThreads.nodes).toEqual([]);
  });

  it("still default-denies any other GraphQL query", () => {
    const dir = layout(BASE);
    const out = gh(dir, ["api", "graphql", "-f", "query={ viewer { login } }"]);
    expect(out.code).toBe(64);
    expect(out.log.at(-1)).toMatchObject({ decision: "denied", exitCode: 64 });
  });
});

describe("fixtures — the PR conversation step 10 reads", () => {
  it.each(["feature-open-pr-all-green", "docs-only-open-pr"])(
    "%s: `pr view <N>` carries empty comments/reviews and a head-commit date",
    (name) => {
      const fx = buildGhFixture(getFixture(name));
      const n = String(fx.branchPr?.number);
      const out = gh(layout(fx), ["pr", "view", n, "--json", "comments,reviews,commits"]);
      expect(out.code).toBe(0);
      const pr = JSON.parse(out.stdout);
      expect(pr.comments).toEqual([]);
      expect(pr.reviews).toEqual([]);
      expect(pr.commits.at(-1).committedDate).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(fx.pullComments).toEqual([]);
      expect(fx.reviewThreads).toEqual([]);
    },
  );

  it("feature-dirty-no-pr (ship-6): the PR `/pr` creates can be viewed by number", () => {
    const fx = buildGhFixture(getFixture("feature-dirty-no-pr"));
    const out = gh(layout(fx), ["pr", "view", "301", "--json", "comments,reviews,commits"]);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout).comments).toEqual([]);
    // No PR for the branch before `/pr` creates one — pr-3 depends on that.
    expect(fx.branchPr).toBeNull();
  });

  it("feature-open-pr-unanswered-comment: one top-level comment posted after the head commit", () => {
    const fx = buildGhFixture(getFixture("feature-open-pr-unanswered-comment"));
    const n = String(fx.branchPr?.number);
    const out = gh(layout(fx), ["pr", "view", n, "--json", "comments,reviews,commits"]);
    expect(out.code).toBe(0);
    const pr = JSON.parse(out.stdout);
    expect(pr.comments).toHaveLength(1);
    expect(Date.parse(pr.comments[0].createdAt)).toBeGreaterThan(Date.parse(pr.commits.at(-1).committedDate));
    expect(pr.reviews).toEqual([]);
    expect(fx.pullComments).toEqual([]);
    expect(fx.reviewThreads).toEqual([]);
  });
});
