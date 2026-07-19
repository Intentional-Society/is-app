// Fixture profiles — plain data, not code or a DSL (spec constraint C13). Each profile
// names a starting-state world for one or more execution evals: the feature branch, the
// commits already on it, any uncommitted ("dirty") working-tree changes, an optional
// preseeded reviewer team-cache, and the `gh` data the stub answers from. make-sandbox
// interprets these fields; adding an eval is usually just naming a new profile here.
//
// Every `fixture` name referenced by a `kind: execution` eval in
// .claude/skills/{commit,pr,ship}/evals/evals.json must appear in FIXTURES below. The
// list of names is the binding acceptance criterion for Phase 2, not a target count.
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

function existingPr(number, headRefName, title) {
  return {
    number,
    headRefName,
    baseRefName: "main",
    state: "OPEN",
    isDraft: false,
    title,
    url: prLink(number),
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
// The 14 profiles.
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

  // ship-2a/2b/2c — pre-existing PR, advisory E2E pending past the 5-minute wait
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
};

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
