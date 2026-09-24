import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getFixture, listFixtures } from "../../../scripts/skill-evals/lib/fixtures.mjs";
import { buildGhFixture } from "../../../scripts/skill-evals/lib/gh-fixture.mjs";

// Unit coverage for the skill-eval `gh` stub's read-only conversation routes (#580, #601):
// the pull-request review-comments REST endpoint, the issue-comments REST endpoint (poster
// account type and posting app) and the review-threads GraphQL query that `/ship` step 10
// reads right before the merge. Each test lays out the minimal directory
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

const ISSUE_COMMENT = {
  id: 2000000011,
  user: { login: "vercel[bot]", type: "Bot" },
  performed_via_github_app: { slug: "vercel" },
  body: "[vc]: #abc123",
  created_at: "2026-09-20T12:05:00Z",
  html_url: "https://github.com/Intentional-Society/is-app/pull/224#issuecomment-2000000011",
};
const ISSUE_COMMENTS_PATH = "repos/Intentional-Society/is-app/issues/224/comments";

describe("gh stub — api repos/<owner>/<repo>/issues/<N>/comments (#601)", () => {
  it("answers a GET with the fixture's issueComments and logs it as answered", () => {
    const dir = layout({ ...BASE, issueComments: [ISSUE_COMMENT] });
    const out = gh(dir, ["api", ISSUE_COMMENTS_PATH]);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual([ISSUE_COMMENT]);
    expect(out.log.at(-1)).toMatchObject({
      decision: "answered",
      exitCode: 0,
      api: "issues/comments",
      paginate: false,
    });
  });

  it("accepts --paginate (one page holds everything) and an explicit -X GET", () => {
    const dir = layout({ ...BASE, issueComments: [ISSUE_COMMENT] });
    const paged = gh(dir, ["api", "--paginate", ISSUE_COMMENTS_PATH]);
    expect(paged.code).toBe(0);
    expect(JSON.parse(paged.stdout)).toEqual([ISSUE_COMMENT]);
    expect(paged.log.at(-1)).toMatchObject({ decision: "answered", api: "issues/comments", paginate: true });
    const explicit = gh(dir, ["api", "-X", "GET", `/${ISSUE_COMMENTS_PATH}`]);
    expect(explicit.code).toBe(0);
    expect(JSON.parse(explicit.stdout)).toHaveLength(1);
  });

  it("answers an empty array when the fixture seeds no issue comments", () => {
    const dir = layout(BASE);
    const out = gh(dir, ["api", "--paginate", ISSUE_COMMENTS_PATH]);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual([]);
  });

  it("default-denies a write to the same endpoint (-X POST / --method POST): the route is read-only", () => {
    const dir = layout({ ...BASE, issueComments: [ISSUE_COMMENT] });
    for (const args of [
      ["api", ISSUE_COMMENTS_PATH, "-X", "POST", "-f", "body=hi"],
      ["api", "--method", "POST", ISSUE_COMMENTS_PATH, "-f", "body=hi"],
      ["api", "--paginate", "-X", "post", ISSUE_COMMENTS_PATH, "-f", "body=hi"],
    ]) {
      const out = gh(dir, args);
      expect(out.code).toBe(64);
      expect(out.stdout).toBe("");
      expect(out.log.at(-1)).toMatchObject({ decision: "denied", exitCode: 64 });
    }
  });

  it("still default-denies a neighbouring endpoint (issues/<N>, issues/<N>/events)", () => {
    const dir = layout(BASE);
    for (const endpoint of [
      "repos/Intentional-Society/is-app/issues/224",
      "repos/Intentional-Society/is-app/issues/224/events",
    ]) {
      const out = gh(dir, ["api", endpoint]);
      expect(out.code).toBe(64);
      expect(out.log.at(-1)).toMatchObject({ decision: "denied", exitCode: 64 });
    }
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

// #601: every top-level comment a profile seeds is served twice — by `gh pr view --json
// comments` (GraphQL shape, logins without `[bot]`) and by the REST issue-comments route
// (`[bot]` logins, `user.type`, app slug). The two reads must describe the same comments.
type RestComment = {
  user: { login: string; type: string };
  performed_via_github_app: { slug: string } | null;
  body: string;
  created_at: string;
  html_url: string;
};
type ViewComment = { author: { login: string }; createdAt: string; body: string; url: string };

describe("fixtures — top-level comments agree across both reads (#601)", () => {
  it("listFixtures() includes the two #601 profiles", () => {
    const names = listFixtures();
    expect(names).toContain("feature-open-pr-bot-cards-only");
    expect(names).toContain("feature-open-pr-review-with-findings");
  });

  it.each([
    ["feature-open-pr-unanswered-comment", 223, 1],
    ["feature-open-pr-bot-cards-only", 224, 3],
    ["feature-open-pr-review-with-findings", 225, 2],
  ])("%s: PR %i's comments match in both shapes (%i each)", (name, number, count) => {
    const fx = buildGhFixture(getFixture(name));
    const dir = layout(fx);
    const view = gh(dir, ["pr", "view", String(number), "--json", "comments,reviews,commits"]);
    const rest = gh(dir, ["api", "--paginate", `repos/Intentional-Society/is-app/issues/${number}/comments`]);
    expect(view.code).toBe(0);
    expect(rest.code).toBe(0);
    const pr = JSON.parse(view.stdout);
    const viewComments: ViewComment[] = pr.comments;
    const restComments: RestComment[] = JSON.parse(rest.stdout);
    expect(viewComments).toHaveLength(count);
    expect(restComments).toHaveLength(count);
    const headAt = Date.parse(pr.commits.at(-1).committedDate);
    restComments.forEach((r, i) => {
      const v = viewComments[i];
      expect(r.created_at).toBe(v.createdAt);
      expect(r.body).toBe(v.body);
      expect(r.html_url).toBe(v.url);
      expect(Date.parse(r.created_at)).toBeGreaterThan(headAt);
      // GraphQL drops the suffix; REST keeps it — and only a Bot carries it.
      expect(v.author.login.endsWith("[bot]")).toBe(false);
      if (r.user.type === "Bot") {
        expect(r.user.login).toBe(`${v.author.login}[bot]`);
        expect(r.performed_via_github_app?.slug).toEqual(expect.any(String));
      } else {
        expect(r.user.type).toBe("User");
        expect(r.user.login).toBe(v.author.login);
        expect(r.performed_via_github_app).toBeNull();
      }
    });
  });

  it("feature-open-pr-bot-cards-only: a Vercel card, a clean Claude review, and /pr's note by the account `gh api user` names", () => {
    const fx = buildGhFixture(getFixture("feature-open-pr-bot-cards-only"));
    const dir = layout(fx);
    const self = gh(dir, ["api", "user", "--jq", ".login"]).stdout.trim();
    const rest: RestComment[] = JSON.parse(
      gh(dir, ["api", "repos/Intentional-Society/is-app/issues/224/comments"]).stdout,
    );
    expect(
      rest.map((c) => [c.user.login, c.user.type, c.performed_via_github_app?.slug ?? null, c.created_at]),
    ).toEqual([
      ["vercel[bot]", "Bot", "vercel", "2026-09-20T12:05:00Z"],
      ["claude[bot]", "Bot", "claude", "2026-09-20T12:17:00Z"],
      [self, "User", null, "2026-09-20T12:20:00Z"],
    ]);
    expect(rest[0].body.startsWith("[vc]:")).toBe(true);
    expect(rest[1].body.split("\n").slice(0, 3)).toEqual([
      "## Code review",
      "",
      "No issues found. Checked for bugs and CLAUDE.md compliance.",
    ]);
    const note = rest[2].body.split("\n");
    expect(note[0]).toBe("_/pr: new commits since the PR body was written_");
    expect(note.filter((l) => l.startsWith("- "))).toHaveLength(1);
    expect(fx.checks.every((c: { bucket: string }) => c.bucket === "pass")).toBe(true);
    expect(fx.runs.length).toBeGreaterThan(0);
    expect(fx.pullComments).toEqual([]);
    expect(fx.reviewThreads).toEqual([]);
    expect(fx.branchPr?.reviews).toEqual([]);
  });

  it("feature-open-pr-review-with-findings: a Vercel card and a Claude review that reports 2 issues", () => {
    const fx = buildGhFixture(getFixture("feature-open-pr-review-with-findings"));
    const rest: RestComment[] = JSON.parse(
      gh(layout(fx), ["api", "repos/Intentional-Society/is-app/issues/225/comments"]).stdout,
    );
    expect(rest.map((c) => [c.user.login, c.performed_via_github_app?.slug, c.created_at])).toEqual([
      ["vercel[bot]", "vercel", "2026-09-20T12:05:00Z"],
      ["claude[bot]", "claude", "2026-09-20T12:17:00Z"],
    ]);
    expect(
      rest[1].body.startsWith(
        "## Code review\n\n2 issues found. Checked for bugs and CLAUDE.md compliance.\n\n### 1. ",
      ),
    ).toBe(true);
    expect(fx.checks.every((c: { bucket: string }) => c.bucket === "pass")).toBe(true);
    expect(fx.pullComments).toEqual([]);
    expect(fx.reviewThreads).toEqual([]);
  });
});
