// Fixture profiles — plain data, not code or a DSL (spec constraint C13). Each profile
// names a starting-state world for one or more execution evals: the feature branch, the
// commits already on it, any uncommitted ("dirty") working-tree changes, an optional
// preseeded reviewer team-cache, and the `gh` data the stub answers from. make-sandbox
// interprets these fields; adding an eval is usually just naming a new profile here.
//
// Every `fixture` name referenced by a `kind: execution` eval in
// .claude/skills/{commit,pr,ship,handoff}/evals/evals.json must appear in FIXTURES below.
// The list of names is the binding acceptance criterion for Phase 2, not a target count.
// Several evals may name the same profile — four of the ten `/handoff` evals have a profile
// of their own and the other six reuse one, each saying so in its own `notes` (issue #585).
//
// Case rule (macOS default FS is case-insensitive): no two file paths within a single
// profile may differ only by case. assertNoCaseCollisions() enforces this at build time.

const OWNER = "Intentional-Society";
const REPO = "is-app";
const SELF = "NorsemanSpiff";

// Five human collaborators (matching the /pr SKILL.md picker example) + the running user +
// two advisory bots the /pr bot filter is expected to drop.
const HUMANS = [
  { login: "AlexisChen99", name: "AlexisChen" },
  { login: "benjifriedman", name: "Benji Friedman" },
  { login: "Ceantaur", name: "Sean" },
  { login: "james-baker", name: "James Baker" },
  { login: "oolu4236", name: "OLA" },
];
const SELF_COLLAB = { login: SELF, name: "Blake" };
const BOTS = [
  { login: "copilot-pull-request-reviewer", name: null },
  { login: "github-advanced-security", name: null },
];
const REVIEWER_COLLABORATORS = [SELF_COLLAB, ...HUMANS, ...BOTS];

const AUTH_OK = { loggedIn: true, login: SELF, host: "github.com" };
const VERCEL_PROD_URL = "https://app.intentionalsociety.org";

const CHECKS_ALL_GREEN = [
  { name: "Lint & Functional Tests", bucket: "pass", state: "SUCCESS", required: true, link: prLink(1, "checks") },
  { name: "E2E", bucket: "pass", state: "SUCCESS", required: false, link: prLink(1, "checks") },
  { name: "CodeQL", bucket: "pass", state: "SUCCESS", required: false, link: prLink(1, "checks") },
];
const CHECKS_ADVISORY_PENDING = [
  { name: "Lint & Functional Tests", bucket: "pass", state: "SUCCESS", required: true, link: prLink(1, "checks") },
  { name: "E2E", bucket: "pending", state: "PENDING", required: false, link: prLink(1, "checks") },
];
const CHECKS_DOCS_ONLY = [
  { name: "Lint & Functional Tests", bucket: "pass", state: "SUCCESS", required: true, link: prLink(1, "checks") },
];
const POST_MERGE_RUNS = [
  {
    databaseId: 9001,
    name: "Vercel — Production",
    status: "completed",
    conclusion: "success",
    url: `https://github.com/${OWNER}/${REPO}/actions/runs/9001`,
  },
  {
    databaseId: 9002,
    name: "e2e (Production)",
    status: "completed",
    conclusion: "success",
    url: `https://github.com/${OWNER}/${REPO}/actions/runs/9002`,
  },
];

function prLink(n, sub) {
  const base = `https://github.com/${OWNER}/${REPO}/pull/${n}`;
  return sub ? `${base}/${sub}` : base;
}

// The committer date every fixture PR's head commit carries — /ship step 10 (#580) takes it
// as the last push time. A fixed instant, so a seeded comment can sit before or after it.
const PR_HEAD_COMMITTED_AT = "2026-09-20T12:00:00Z";

function existingPr(number, headRefName, title) {
  return {
    number,
    headRefName,
    baseRefName: "main",
    state: "OPEN",
    isDraft: false,
    title,
    url: prLink(number),
    // The conversation /ship step 10 reads: nothing by default.
    comments: [],
    reviews: [],
    commits: [{ committedDate: PR_HEAD_COMMITTED_AT }],
  };
}

// ---------------------------------------------------------------------------------------
// Top-level PR comments, seeded in both shapes /ship step 10 reads (#580, #601):
//   * `gh pr view --json comments` (GraphQL): `author.login` WITHOUT the `[bot]` suffix —
//     real GraphQL drops it, so this read cannot tell a bot from a person;
//   * `gh api repos/<o>/<r>/issues/<N>/comments` (REST, the stub's `issueComments`):
//     `user.login` WITH `[bot]` for a bot, plus `user.type` and
//     `performed_via_github_app.slug`.
// A comment spec is written once and rendered into both (viewComments / restIssueComments,
// below the profiles), so the two reads always agree: same count, order, time, body, link.
//   spec: { id, login, type: "User" | "Bot", app: <slug> | null, association, createdAt, body }
//   `login` is the account's base login (no `[bot]`); the REST render appends it for a Bot.
// Declared here, above FIXTURES, because the profiles read them at module load.
// ---------------------------------------------------------------------------------------

// ship-7: a plain top-level comment by a non-app account (the #578-miss shape).
const REVIEWED_COMMENT = {
  id: 2000000001,
  login: "sandbox-review-bot",
  type: "User",
  app: null,
  association: "NONE",
  createdAt: "2026-09-20T12:17:00Z",
  body:
    "The README still describes the old report flag; update it before merging.\n\n" +
    "It says `--report` writes to `out/`, but the code in this PR writes to `reports/`.",
};

// The Vercel deployment card: a Bot posting via the `vercel` app, body beginning `[vc]:`.
const VERCEL_CARD = {
  id: 2000000011,
  login: "vercel",
  type: "Bot",
  app: "vercel",
  association: "NONE",
  createdAt: "2026-09-20T12:05:00Z",
  body:
    "[vc]: #abc123def456:eyJpc01vbm9yZXBvIjpmYWxzZSwidHlwZSI6ImdpdGh1YiJ9\n" +
    "The latest updates on your projects. Learn more about [Vercel for GitHub](https://vercel.link/github-learn-more).\n\n" +
    "| Name | Status | Preview | Updated (UTC) |\n" +
    "| :--- | :----- | :------ | :------ |\n" +
    "| **is-app** | Ready ([Inspect](https://vercel.com/intentional-society/is-app/abc123)) | " +
    "[Visit Preview](https://is-app-git-feature.vercel.app) | Sep 20, 2026 12:05pm |\n",
};

// A Claude review that found nothing, posted via the `claude` app — excluded (#601).
const CLAUDE_REVIEW_CLEAN = {
  id: 2000000012,
  login: "claude",
  type: "Bot",
  app: "claude",
  association: "NONE",
  createdAt: "2026-09-20T12:17:00Z",
  body: "## Code review\n\nNo issues found. Checked for bugs and CLAUDE.md compliance.",
};

// A Claude review that REPORTS issues — still counts as unanswered (#601).
const CLAUDE_REVIEW_WITH_FINDINGS = {
  id: 2000000013,
  login: "claude",
  type: "Bot",
  app: "claude",
  association: "NONE",
  createdAt: "2026-09-20T12:17:00Z",
  body:
    "## Code review\n\n2 issues found. Checked for bugs and CLAUDE.md compliance.\n\n" +
    "### 1. The new handler never awaits the write\n\n" +
    "`src/app/flagged.ts` returns before the insert resolves, so a failure is silently dropped.\n\n" +
    "### 2. CLAUDE.md: raw `fetch` instead of `apiClient`\n\n" +
    "CLAUDE.md says to use the Hono RPC client (`apiClient`) rather than raw `fetch`.",
};

// /pr step 10's new-commits note, posted by the account running the ship (SELF — the
// fixture's `self`, which the stub's `gh api user --jq .login` returns), stamped with the
// fixed first line.
function prNoteBySelf(commitSubject) {
  return {
    id: 2000000014,
    login: SELF,
    type: "User",
    app: null,
    association: "MEMBER",
    createdAt: "2026-09-20T12:20:00Z",
    body:
      "_/pr: new commits since the PR body was written_\n\n" +
      `- \`${commitSubject}\` — the change this PR describes, pushed after the body was drafted.`,
  };
}

// ---------------------------------------------------------------------------------------
// Shared baseline: the files committed to `main` in every sandbox's first commit.
// ---------------------------------------------------------------------------------------

const BASE_PACKAGE_JSON = `${JSON.stringify(
  {
    name: "sandbox-app",
    version: "0.0.0",
    private: true,
    // Fake, instant `npm test` — make-sandbox copies .skill-eval-fake-test.mjs alongside.
    scripts: { test: "node .skill-eval-fake-test.mjs" },
  },
  null,
  2,
)}\n`;

const BASE_SCHEMA_TS = `import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const members = pgTable("members", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at").defaultNow(),
});
`;

const BASE_API_TS = `import { Hono } from "hono";

export const api = new Hono();

api.get("/health", (c) => c.json({ ok: true }));

// Public response shape consumed by clients. profile.legacyId is deprecated.
api.get("/profile", (c) => c.json({ id: 1, legacyId: "legacy-1", displayName: "Sandbox" }));
`;

const BASE_PAGE_TSX = `export default function Page() {
  return <main>Sandbox home</main>;
}
`;

const BASE_GITIGNORE = `node_modules/
# harness control + generated files — never part of an eval's payload
.skill-eval-sandbox
.skill-eval-fake-test.mjs
.skill-eval-fail-test
.claude/.nl-delegation-active
.claude/skip-nl-confirm-commit-pr.local
.claude/skills/**/.team-cache.json
`;

const BASE_FILES = {
  "package.json": BASE_PACKAGE_JSON,
  "README.md": "# Sandbox app\n\nThrowaway repo built by scripts/skill-evals for skill-eval execution.\n",
  "CLAUDE.md": "# CLAUDE.md (sandbox)\n\nThrowaway sandbox project instructions.\n",
  ".gitignore": BASE_GITIGNORE,
  "src/server/schema.ts": BASE_SCHEMA_TS,
  "src/server/api.ts": BASE_API_TS,
  "src/app/page.tsx": BASE_PAGE_TSX,
  "docs/devjournal.md": "# Dev journal\n\nMost recent first.\n",
};

// A feature file body, parameterised by feature slug (no template-literal interpolation in
// stored content — keep it plain so nothing in a fixture is mistaken for executable code).
function featureModule(slug) {
  return `export const feature = ${JSON.stringify(slug)};\n`;
}

// ---------------------------------------------------------------------------------------
// /handoff worlds (issue #585). File bodies for the four `/handoff` profiles, derived from
// the pre-harness builder `.claude/skills/handoff/evals/build_fixtures.mjs` but rebuilt on
// this module's own baseline so a handoff sandbox is the same shape as every other one.
// ---------------------------------------------------------------------------------------

// `/handoff` writes its doc to `.scratch/<slug>-bootstrap.md` and its SKILL.md promises that
// path is already gitignored. The shared baseline does not ignore it, so the handoff profiles
// extend the baseline rather than changing `.gitignore` for all twenty-one profiles.
const HANDOFF_GITIGNORE = `${BASE_GITIGNORE}# agent scratch notes — where /handoff writes its hand-off doc
.scratch/
`;

const NOTIFIER_BUGGY = `const MAX_RETRIES = 3;

export async function sendWithRetry(send: () => Promise<void>) {
  let attempts = 0;
  for (;;) {
    try {
      await send();
      return;
    } catch (err) {
      attempts += 1;
      if (isTimeout(err)) attempts += 1; // timeouts count twice, exhausting retries early
      if (attempts >= MAX_RETRIES) throw err;
    }
  }
}

function isTimeout(err: unknown) {
  return err instanceof Error && err.message.includes("timeout");
}
`;

const NOTIFIER_FIXED = NOTIFIER_BUGGY.replace(
  "      attempts += 1;\n      if (isTimeout(err)) attempts += 1; // timeouts count twice, exhausting retries early\n",
  "      attempts += 1; // every failure counts exactly once, timeout or not\n",
);

const BUTTONDOWN_BASE = `export async function mirrorProgramTags(
  api: { setTags(email: string, tags: string[]): Promise<void> },
  rows: { email: string; tags: string[] }[],
) {
  for (const row of rows) {
    await api.setTags(row.email, row.tags);
  }
}
`;

const BUTTONDOWN_BATCHED = `const BATCH_SIZE = 25;

export async function mirrorProgramTags(
  api: { setTags(email: string, tags: string[]): Promise<void> },
  rows: { email: string; tags: string[] }[],
) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((row) => api.setTags(row.email, row.tags)));
  }
}
`;

// The uncommitted follow-up edit: the session's own open question, left in the tree.
const BUTTONDOWN_OPEN_QUESTION = BUTTONDOWN_BATCHED.replace(
  "const BATCH_SIZE = 25;",
  `const BATCH_SIZE = 25;
// TODO(open question): does Buttondown's rate limit require backoff between batches?
const BATCH_DELAY_MS = 0;`,
);

const API_TAG_MIRROR = `${BASE_API_TS}
api.post("/cron/buttondown-mirror", (c) => c.json({ mirrored: true, includesProgramTags: true }));
`;

const SCHEMA_WITH_STATUS = BASE_SCHEMA_TS.replace(
  '  createdAt: timestamp("created_at").defaultNow(),',
  '  status: text("status").notNull().default("active"),\n  createdAt: timestamp("created_at").defaultNow(),',
);

// The expand half of an expand-contract migration: the new column lands alongside the old one.
const SCHEMA_STATUS_EXPANDED = SCHEMA_WITH_STATUS.replace(
  '  status: text("status").notNull().default("active"),',
  '  status: text("status").notNull().default("active"),\n  statusV2: text("status_v2").notNull().default("active"),',
);

const MIGRATION_EXPAND_SQL = `-- expand step: add the new column alongside the old one (the contract step ships later)
ALTER TABLE "members" ADD COLUMN "status_v2" text NOT NULL DEFAULT 'active';
`;

// Write path dual-writes; the read path is still on the old column — the half-implemented change.
const API_DUAL_WRITE = `${BASE_API_TS}
// Read path above still serves the OLD column only — the reader migration is not written yet.
api.post("/members/:id/status", (c) => c.json({ wrote: ["status", "status_v2"] }));
`;

const MEMBERS_PAGE_BASE = `export default function MembersPage() {
  return (
    <main>
      <h1>Members</h1>
      <ul data-testid="member-list" />
    </main>
  );
}
`;

// A teammate's work-in-progress edit sitting in the tree, which this session never made.
const MEMBERS_PAGE_TEAMMATE_WIP = MEMBERS_PAGE_BASE.replace(
  '      <ul data-testid="member-list" />',
  `      {/* WIP: status filter experiment */}
      <select data-testid="status-filter" />
      <ul data-testid="member-list" />`,
);

// ---------------------------------------------------------------------------------------
// The 21 profiles.
// ---------------------------------------------------------------------------------------

/** @type {Record<string, object>} */
const FIXTURES = {
  // commit-1
  "feature-dirty-clean-payload": {
    summary: "Dirty feature branch; a handful of profile-redirect edits; no .env, no generated artifacts.",
    branch: "fix-profile-redirect",
    branchCommits: [],
    working: {
      write: {
        "src/app/page.tsx": "export default function Page() {\n  return <main>Sandbox home (redirect fix)</main>;\n}\n",
        "src/lib/profile-redirect.ts":
          'export function profileRedirect(path: string) {\n  return path.startsWith("/profile") ? "/me" : path;\n}\n',
      },
    },
    gh: { owner: OWNER, repo: REPO, auth: AUTH_OK, self: SELF },
  },

  // commit-2
  "feature-dirty-with-env-local": {
    summary: "Feature branch with edits to src/server/api.ts AND a modified .env.local in the working tree.",
    branch: "add-user-endpoint",
    baseFilesExtra: { ".env.local": "NEXT_PUBLIC_SANDBOX=1\nSANDBOX_SECRET=fake-do-not-use\n" },
    branchCommits: [],
    working: {
      write: {
        "src/server/api.ts": `${BASE_API_TS}\napi.post("/users", (c) => c.json({ created: true }));\n`,
        ".env.local": "NEXT_PUBLIC_SANDBOX=1\nSANDBOX_SECRET=fake-do-not-use\nNEW_FLAG=on\n",
      },
    },
    gh: { owner: OWNER, repo: REPO, auth: AUTH_OK, self: SELF },
  },

  // commit-3a — /commit #142, expand-only schema payload
  "feature-schema-expand-only": {
    summary: "Issue 142 open; payload is an expand-only schema change plus a new drizzle migration.",
    branch: "142-schema-expand",
    branchCommits: [],
    working: {
      write: {
        "src/server/schema.ts": BASE_SCHEMA_TS.replace(
          '  createdAt: timestamp("created_at").defaultNow(),\n});',
          '  bio: text("bio"),\n  createdAt: timestamp("created_at").defaultNow(),\n});',
        ),
        "drizzle/0019_add_column.sql": 'ALTER TABLE "members" ADD COLUMN "bio" text;\n',
      },
    },
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      issues: {
        142: {
          number: 142,
          state: "OPEN",
          title: "Add member bio column",
          body: "Expand the members table with a bio column.",
        },
      },
    },
  },

  // commit-3b — /commit #142, combined expand+contract (hard refusal)
  "feature-schema-expand-plus-contract": {
    summary: "Issue 142 open; payload adds one column AND drops another in the same schema.ts edit.",
    branch: "142-schema-change",
    branchCommits: [],
    working: {
      write: {
        // Adds bio (expand) and removes displayName (contract) in one diff.
        "src/server/schema.ts": `import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const members = pgTable("members", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  bio: text("bio"),
  createdAt: timestamp("created_at").defaultNow(),
});
`,
      },
    },
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      issues: {
        142: { number: 142, state: "OPEN", title: "Reshape members table", body: "Add bio, drop displayName." },
      },
    },
  },

  // pr-1 — existing PR, 2 new commits since last push, comment-on-push
  "feature-open-pr-two-new-commits": {
    summary: "Feature branch with an open PR; 2 commits ahead of the last push; clean tree; origin/main not advanced.",
    branch: "feature-dashboard",
    branchCommits: [
      {
        message: "feat: dashboard scaffold",
        write: {
          "src/app/dashboard/page.tsx": "export default function Dashboard() {\n  return <main>Dashboard</main>;\n}\n",
        },
      },
      {
        message: "feat: dashboard widgets",
        write: { "src/app/dashboard/widgets.ts": featureModule("dashboard-widgets") },
      },
      {
        message: "feat: dashboard filters",
        write: { "src/app/dashboard/filters.ts": featureModule("dashboard-filters") },
      },
    ],
    pushedBranchCommits: 1,
    openPr: true,
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      collaborators: REVIEWER_COLLABORATORS,
      branchPr: existingPr(210, "feature-dashboard", "feat: dashboard"),
    },
  },

  // pr-2 — /pr 145 where PR 145 is on a different branch
  "feature-x-with-pr-on-feature-y": {
    summary: "Checkout on feature-x; PR 145 is on feature-y; refuse to switch.",
    branch: "feature-x",
    branchCommits: [{ message: "feat: x work", write: { "src/app/x.ts": featureModule("feature-x") } }],
    openPr: false,
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      prs: { 145: existingPr(145, "feature-y", "feat: y work") },
    },
  },

  // pr-3 (and reused by ship-6) — dirty tree, no PR; /pr delegates to /commit then creates PR
  "feature-dirty-no-pr": {
    summary:
      "Dirty feature branch, no PR. /pr delegates to /commit then opens a PR; /ship (ship-6) continues to merge.",
    branch: "wire-up-dashboard",
    branchCommits: [],
    working: {
      write: {
        "src/app/dashboard/page.tsx":
          "export default function Dashboard() {\n  return <main>Dashboard (wired)</main>;\n}\n",
        "src/app/dashboard/data.ts": featureModule("dashboard-data"),
      },
    },
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      collaborators: REVIEWER_COLLABORATORS,
      branchPr: null,
      createPr: { number: 301, url: prLink(301) },
      // ship-6 reads the created PR's conversation by number before the merge (step 10, #580).
      prs: { 301: existingPr(301, "wire-up-dashboard", "feat: wire up dashboard") },
      // ship-6 continues past PR creation into the merge — the created PR's checks are green.
      checks: CHECKS_ALL_GREEN,
      runs: POST_MERGE_RUNS,
      vercelProductionUrl: VERCEL_PROD_URL,
    },
  },

  // pr-4 — new PR, CC title with breaking-change flag
  "feature-breaking-change-no-pr": {
    summary: "Clean feature branch, one commit removing a public API field (breaking change); no PR.",
    branch: "remove-legacy-id",
    branchCommits: [
      {
        message: "feat!: remove deprecated profile.legacyId field",
        write: {
          "src/server/api.ts": `import { Hono } from "hono";

export const api = new Hono();

api.get("/health", (c) => c.json({ ok: true }));

// Public response shape consumed by clients.
api.get("/profile", (c) => c.json({ id: 1, displayName: "Sandbox" }));
`,
        },
      },
    ],
    openPr: false,
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      collaborators: REVIEWER_COLLABORATORS,
      branchPr: null,
      createPr: { number: 302, url: prLink(302) },
    },
  },

  // pr-5 — reviewer cold cache, numeric pick "1 3"
  "feature-no-pr-cold-reviewer-cache": {
    summary: "Clean single-commit branch, no PR, NO team cache (cold). 5 human collaborators after bot-filtering.",
    branch: "add-widget",
    branchCommits: [{ message: "feat: add widget", write: { "src/app/widget.ts": featureModule("widget") } }],
    openPr: false,
    teamCache: null,
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      collaborators: REVIEWER_COLLABORATORS,
      branchPr: null,
      createPr: { number: 303, url: prLink(303) },
    },
  },

  // pr-6 — reviewer warm cache (3 days old), NL resolution "james and benji"
  "feature-no-pr-warm-reviewer-cache": {
    summary:
      "Clean single-commit branch, no PR, warm team cache (refreshedAt 3 days ago). Skill fires zero gh api calls.",
    branch: "add-thing",
    branchCommits: [{ message: "feat: add thing", write: { "src/app/thing.ts": featureModule("thing") } }],
    openPr: false,
    teamCache: { refreshedAtDaysAgo: 3, collaborators: HUMANS.map((h) => h.login) },
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      collaborators: REVIEWER_COLLABORATORS,
      branchPr: null,
      createPr: { number: 304, url: prLink(304) },
    },
  },

  // pr-7 — reviewer stale cache (5 days old) with a removed login; gh rejection -> refresh -> re-ask
  "feature-no-pr-stale-reviewer-cache": {
    summary:
      "Clean single-commit branch, no PR, cache (5 days old) contains removed login `formerteam`; gh rejects it.",
    branch: "add-report",
    branchCommits: [{ message: "feat: add report", write: { "src/app/report.ts": featureModule("report") } }],
    openPr: false,
    teamCache: {
      refreshedAtDaysAgo: 5,
      collaborators: [...HUMANS.map((h) => h.login), "formerteam"],
      extraDisplayNames: { formerteam: "Former Teammate" },
    },
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      // Post-refresh collaborator list — `formerteam` is gone.
      collaborators: REVIEWER_COLLABORATORS,
      branchPr: null,
      createPr: { number: 305, url: prLink(305) },
      // Per-call sequenced `gh pr create`: first call (reviewer formerteam) fails; second succeeds.
      sequences: {
        "pr create": [
          {
            ok: false,
            exitCode: 1,
            stderr:
              "GraphQL: Could not resolve to a User with the login of 'formerteam'. (addPullRequestReviewers)\n" +
              "could not add reviewer: 'formerteam' is not a collaborator on " +
              OWNER +
              "/" +
              REPO +
              "\n",
          },
          { ok: true, number: 305, url: prLink(305) },
        ],
      },
    },
  },

  // ship-1 — pre-existing PR, all green, merge + post-merge watch
  "feature-open-pr-all-green": {
    summary: "Pre-existing open PR; clean; all required + advisory checks green; no schema expand; merges.",
    branch: "feature-ready",
    branchCommits: [{ message: "feat: ready feature", write: { "src/app/ready.ts": featureModule("ready") } }],
    openPr: true,
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      branchPr: existingPr(220, "feature-ready", "feat: ready feature"),
      prs: { 220: existingPr(220, "feature-ready", "feat: ready feature") },
      checks: CHECKS_ALL_GREEN,
      runs: POST_MERGE_RUNS,
      vercelProductionUrl: VERCEL_PROD_URL,
    },
  },

  // ship-2a/2b — pre-existing PR, advisory E2E pending past the 5-minute wait
  "feature-open-pr-advisory-pending": {
    summary:
      "Pre-existing open PR; required check green; advisory E2E still pending after the 5-minute wait; no merge.",
    branch: "feature-pending",
    branchCommits: [{ message: "feat: pending feature", write: { "src/app/pending.ts": featureModule("pending") } }],
    openPr: true,
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      branchPr: existingPr(221, "feature-pending", "feat: pending feature"),
      prs: { 221: existingPr(221, "feature-pending", "feat: pending feature") },
      checks: CHECKS_ADVISORY_PENDING,
    },
  },

  // ship-3 — docs-only PR; absent advisories are expected; merge on required-green only
  "docs-only-open-pr": {
    summary: "Docs-only branch (docs/** + root CLAUDE.md) with an open PR; advisories skipped by design; merges.",
    branch: "docs-update",
    branchCommits: [
      {
        message: "docs: update devjournal and CLAUDE",
        write: {
          "docs/devjournal.md":
            "# Dev journal\n\nMost recent first.\n\n## 2026 — sandbox docs update\n\nA docs-only change.\n",
          "CLAUDE.md": "# CLAUDE.md (sandbox)\n\nThrowaway sandbox project instructions.\n\nDocs-only edit.\n",
        },
      },
    ],
    openPr: true,
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      branchPr: existingPr(222, "docs-update", "docs: update devjournal and CLAUDE"),
      prs: { 222: existingPr(222, "docs-update", "docs: update devjournal and CLAUDE") },
      checks: CHECKS_DOCS_ONLY,
      runs: POST_MERGE_RUNS,
      vercelProductionUrl: VERCEL_PROD_URL,
    },
  },

  // ship-7 — pre-existing PR, all green, but a review bot commented after the last push (#580)
  "feature-open-pr-unanswered-comment": {
    summary:
      "Pre-existing open PR; clean; all checks green; one top-level bot comment posted 17 minutes after the head commit; no merge.",
    branch: "feature-reviewed",
    branchCommits: [{ message: "feat: reviewed feature", write: { "src/app/reviewed.ts": featureModule("reviewed") } }],
    openPr: true,
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      branchPr: prWithComment(223, "feature-reviewed", "feat: reviewed feature"),
      prs: { 223: prWithComment(223, "feature-reviewed", "feat: reviewed feature") },
      // The same comment as the REST issue-comments endpoint returns it (#601), so the two
      // reads of the one conversation agree.
      issueComments: restIssueComments(223, [REVIEWED_COMMENT]),
      checks: CHECKS_ALL_GREEN,
      runs: POST_MERGE_RUNS,
      vercelProductionUrl: VERCEL_PROD_URL,
      pullComments: [],
      reviewThreads: [],
    },
  },

  // ship-8 — pre-existing PR, all green; the only post-push comments are the three automated
  // posts /ship step 10 excludes (#601): the Vercel card, a clean Claude review and /pr's own
  // new-commits note. Merges.
  "feature-open-pr-bot-cards-only": {
    summary:
      "Pre-existing open PR; clean; all checks green; after the head commit only a Vercel deployment card, a clean Claude review and the running account's own /pr new-commits note; merges.",
    branch: "feature-carded",
    branchCommits: [{ message: "feat: carded feature", write: { "src/app/carded.ts": featureModule("carded") } }],
    openPr: true,
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      ...prWithComments(224, "feature-carded", "feat: carded feature", [
        VERCEL_CARD,
        CLAUDE_REVIEW_CLEAN,
        prNoteBySelf("feat: carded feature"),
      ]),
      checks: CHECKS_ALL_GREEN,
      runs: POST_MERGE_RUNS,
      vercelProductionUrl: VERCEL_PROD_URL,
      pullComments: [],
      reviewThreads: [],
    },
  },

  // ship-9 — pre-existing PR, all green; after the push a Vercel card (excluded) and a Claude
  // review that REPORTS issues (not excluded, #601). No merge.
  "feature-open-pr-review-with-findings": {
    summary:
      "Pre-existing open PR; clean; all checks green; after the head commit a Vercel deployment card and a Claude review reporting 2 issues; no merge.",
    branch: "feature-flagged",
    branchCommits: [{ message: "feat: flagged feature", write: { "src/app/flagged.ts": featureModule("flagged") } }],
    openPr: true,
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      ...prWithComments(225, "feature-flagged", "feat: flagged feature", [VERCEL_CARD, CLAUDE_REVIEW_WITH_FINDINGS]),
      checks: CHECKS_ALL_GREEN,
      runs: POST_MERGE_RUNS,
      vercelProductionUrl: VERCEL_PROD_URL,
      pullComments: [],
      reviewThreads: [],
    },
  },

  // handoff-1 (reused by handoff-6) — the fix is still in the working tree, nothing committed
  "feature-uncommitted-fix-no-pr": {
    summary:
      "Feature branch for issue 486; the retry-count fix is UNCOMMITTED in the working tree; no commits ahead of main; no PR.",
    branch: "486-notifier-retry-fix",
    baseFilesExtra: { ".gitignore": HANDOFF_GITIGNORE, "src/server/notifier.ts": NOTIFIER_BUGGY },
    branchCommits: [],
    working: { write: { "src/server/notifier.ts": NOTIFIER_FIXED } },
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      branchPr: null,
      issues: {
        486: {
          number: 486,
          state: "OPEN",
          title: "Notifier retry count double-increments on timeout",
          body: "A timeout increments the attempt counter twice, so the retry budget is exhausted early.",
        },
      },
    },
  },

  // handoff-4 (reused by handoff-2 and handoff-3) — one commit ahead, clean tree, no PR
  "feature-one-commit-clean-no-pr": {
    summary: "Feature branch for issue 486 with the retry-count fix COMMITTED (one commit ahead); clean tree; no PR.",
    branch: "486-notifier-retry-fix",
    baseFilesExtra: { ".gitignore": HANDOFF_GITIGNORE, "src/server/notifier.ts": NOTIFIER_BUGGY },
    branchCommits: [
      {
        message: "fix(notifier): stop double-counting retries",
        write: { "src/server/notifier.ts": NOTIFIER_FIXED },
      },
    ],
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      branchPr: null,
      issues: {
        486: {
          number: 486,
          state: "OPEN",
          title: "Notifier retry count double-increments on timeout",
          body: "A timeout increments the attempt counter twice, so the retry budget is exhausted early.",
        },
      },
    },
  },

  // handoff-7 — two commits ahead, one uncommitted follow-up, an open issue, no PR
  "feature-two-commits-dirty-open-issue": {
    summary:
      "Two workstreams on one branch: two commits ahead of main, one uncommitted follow-up edit, open issue 512, no PR.",
    branch: "512-buttondown-tag-mirror",
    baseFilesExtra: { ".gitignore": HANDOFF_GITIGNORE, "src/server/buttondown.ts": BUTTONDOWN_BASE },
    branchCommits: [
      {
        message: "fix(buttondown): batch tag-mirror calls in the cron",
        write: { "src/server/buttondown.ts": BUTTONDOWN_BATCHED },
      },
      {
        message: "fix(api): include program tags in the mirror endpoint",
        write: { "src/server/api.ts": API_TAG_MIRROR },
      },
    ],
    working: { write: { "src/server/buttondown.ts": BUTTONDOWN_OPEN_QUESTION } },
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      branchPr: null,
      issues: {
        512: {
          number: 512,
          state: "OPEN",
          title: "Buttondown tag mirror misses program tags",
          body: "The nightly mirror drops program tags; batching may also be needed for the rate limit.",
        },
      },
    },
  },

  // handoff-8 (reused by handoff-5, handoff-9 and handoff-10) — half-done expand-contract
  // migration, an open PR with one check still running, and a teammate's WIP file in the tree
  "feature-migration-open-pr-teammate-wip": {
    summary:
      "Expand migration + dual-write committed (two commits, pushed) with the read path still on the old column; a teammate's WIP file modified in the tree; open PR 520, one check pending.",
    branch: "518-member-status-migration",
    baseFilesExtra: {
      ".gitignore": HANDOFF_GITIGNORE,
      "src/server/schema.ts": SCHEMA_WITH_STATUS,
      "src/app/members/page.tsx": MEMBERS_PAGE_BASE,
    },
    branchCommits: [
      {
        message: "feat(db): expand migration — add members.status_v2 alongside status",
        write: {
          "drizzle/0042_member_status_expand.sql": MIGRATION_EXPAND_SQL,
          "src/server/schema.ts": SCHEMA_STATUS_EXPANDED,
        },
      },
      {
        message: "feat(api): dual-write member status to the old and new columns",
        write: { "src/server/api.ts": API_DUAL_WRITE },
      },
    ],
    openPr: true,
    working: { write: { "src/app/members/page.tsx": MEMBERS_PAGE_TEAMMATE_WIP } },
    gh: {
      owner: OWNER,
      repo: REPO,
      auth: AUTH_OK,
      self: SELF,
      // `gh pr view --json …statusCheckRollup,reviewDecision` (the /handoff step-2 call) gets
      // the whole object back from the stub, so the PR carries those two extra fields.
      branchPr: {
        ...existingPr(520, "518-member-status-migration", "feat(members): status expand migration + dual write path"),
        reviewDecision: "REVIEW_REQUIRED",
        statusCheckRollup: [
          { name: "Lint & Functional Tests", status: "COMPLETED", conclusion: "SUCCESS" },
          { name: "E2E", status: "IN_PROGRESS", conclusion: "" },
        ],
      },
      issues: {
        518: {
          number: 518,
          state: "OPEN",
          title: "Member status enum migration (expand-contract)",
          body: "Migrate members.status to status_v2 in expand-contract order; the contract step ships last.",
        },
      },
    },
  },
};

/** The `gh pr view --json comments` shape of seeded comment specs (no `[bot]` suffix). */
function viewComments(number, specs) {
  return specs.map((c) => ({
    author: { login: c.login },
    authorAssociation: c.association,
    createdAt: c.createdAt,
    body: c.body,
    url: `${prLink(number)}#issuecomment-${c.id}`,
  }));
}

/** The REST `issues/<N>/comments` shape of seeded comment specs (`[bot]` suffix for a Bot). */
function restIssueComments(number, specs) {
  return specs.map((c) => ({
    id: c.id,
    user: { login: c.type === "Bot" ? `${c.login}[bot]` : c.login, type: c.type },
    performed_via_github_app: c.app ? { slug: c.app } : null,
    body: c.body,
    created_at: c.createdAt,
    html_url: `${prLink(number)}#issuecomment-${c.id}`,
  }));
}

/**
 * An open PR carrying seeded top-level comments, as the `gh` fixture fields that hold it:
 * `branchPr` and `prs[number]` (the `gh pr view` shape) plus `issueComments` (the REST shape).
 */
function prWithComments(number, headRefName, title, specs) {
  const pr = { ...existingPr(number, headRefName, title), comments: viewComments(number, specs) };
  return { branchPr: pr, prs: { [number]: pr }, issueComments: restIssueComments(number, specs) };
}

// ship-7's PR: one plain top-level comment, not a review — the shape of the PR #578 miss.
function prWithComment(number, headRefName, title) {
  return { ...existingPr(number, headRefName, title), comments: viewComments(number, [REVIEWED_COMMENT]) };
}

/** All fixture names, sorted. */
export function listFixtures() {
  return Object.keys(FIXTURES).sort();
}

/** Look up a profile by name; throws with the available names on a miss. */
export function getFixture(name) {
  const profile = FIXTURES[name];
  if (!profile) {
    throw new Error(`Unknown fixture: ${JSON.stringify(name)}\nAvailable fixtures:\n  ${listFixtures().join("\n  ")}`);
  }
  assertNoCaseCollisions(name, profile);
  return { name, ...profile };
}

/** Enforce the "no case-distinct filenames" rule (macOS default FS is case-insensitive). */
export function assertNoCaseCollisions(name, profile) {
  const paths = new Set();
  const seenLower = new Map();
  const add = (p) => {
    if (p) paths.add(p);
  };
  for (const p of Object.keys(BASE_FILES)) add(p);
  for (const p of Object.keys(profile.baseFilesExtra || {})) add(p);
  for (const commit of profile.branchCommits || []) {
    for (const p of Object.keys(commit.write || {})) add(p);
    for (const p of commit.delete || []) add(p);
  }
  for (const p of Object.keys(profile.working?.write || {})) add(p);
  for (const p of profile.working?.delete || []) add(p);
  for (const p of paths) {
    const lower = p.toLowerCase();
    const prior = seenLower.get(lower);
    if (prior && prior !== p) {
      throw new Error(
        "Fixture " +
          JSON.stringify(name) +
          " has case-colliding paths (" +
          prior +
          " vs " +
          p +
          "). " +
          "Fixtures must never rely on case-distinct filenames.",
      );
    }
    seenLower.set(lower, p);
  }
}

export { BASE_FILES, HUMANS, OWNER, REPO, REVIEWER_COLLABORATORS, SELF };
