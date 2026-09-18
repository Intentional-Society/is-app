#!/usr/bin/env node
// Builds isolated fixture repos for the /handoff skill evals (see evals.json "fixture" fields).
//
// Usage: node build_fixtures.mjs <output-root>
//
// For each eval and each run configuration it emits <root>/eval-<id>-<config>/ containing:
//   origin.git/    bare repo standing in for GitHub (remote is the relative path ../origin.git)
//   repo/          the working repo the tested agent operates in
//   fixture-bin/   stub `gh` CLI (gh, gh.cmd, gh-stub.mjs, responses.json) — prepend to PATH
//
// Every run gets its own full copy because tested agents mutate fixture state (.scratch docs,
// possible commits). Subagents must be pointed ONLY at these copies, never the real repo.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.argv[2];
if (!root) {
  process.stderr.write("usage: node build_fixtures.mjs <output-root>\n");
  process.exit(1);
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
const write = (repo, rel, content) => {
  const p = join(repo, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
};

// ---------------------------------------------------------------------------
// Baseline file set shared by every fixture (a minimal stand-in for is-app).
// ---------------------------------------------------------------------------

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

const AVATARS_BASE = `export const SIGNED_URL_TTL_SECONDS = 60;

export async function signedAvatarUrl(storage: { sign(p: string, ttl: number): Promise<string> }, memberId: string) {
  return storage.sign(\`avatars/\${memberId}.webp\`, SIGNED_URL_TTL_SECONDS);
}
`;

const AVATARS_TTL_FIXED = AVATARS_BASE.replace("= 60;", "= 3600;");

const AVATARS_FOLLOWUP = AVATARS_TTL_FIXED.replace(
  "export async function signedAvatarUrl",
  `const urlCache = new Map<string, { url: string; expiresAt: number }>();

export async function signedAvatarUrl`,
);

const CLIENT_BASE = `import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
`;

const CLIENT_MYSTERY_EDIT = CLIENT_BASE.replace(
  "    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,\n  );",
  "    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,\n    { auth: { persistSession: false } },\n  );",
);

const BIOME_BASE = `{
  "linter": {
    "rules": {
      "suspicious": {
        "noExplicitAny": "error"
      }
    }
  }
}
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

const BUTTONDOWN_BASE = `export async function mirrorProgramTags(api: { setTags(email: string, tags: string[]): Promise<void> }, rows: { email: string; tags: string[] }[]) {
  for (const row of rows) {
    await api.setTags(row.email, row.tags);
  }
}
`;

const API_BASE = `import { Hono } from "hono";

export const api = new Hono()
  .get("/health", (c) => c.json({ ok: true }))
  .get("/members", (c) => c.json({ members: [] }));
`;

const SCHEMA_BASE = `import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").notNull().default("active"),
});
`;

const BASELINE_FILES = {
  "CLAUDE.md": `# CLAUDE.md

Intentional Society web application (fixture stand-in). Next.js + Hono + Drizzle + Supabase.

## Commands

- \`npm run test:functional\` — Vitest (fixture: instant, prints results)
- \`npm test\` — all suites (fixture: instant, prints results)

## Workflow

Trunk-based: feature branches PR into main. Hand-off docs live in gitignored \`.scratch/\`.
`,
  ".gitignore": `node_modules/
.env.local
.scratch/
`,
  "package.json": `{
  "name": "is-app",
  "private": true,
  "scripts": {
    "test": "node -e \\"console.log('vitest: 24 passed, 0 failed (functional) | playwright: skipped in fixture')\\"",
    "test:functional": "node -e \\"console.log('vitest: 24 passed, 0 failed')\\""
  }
}
`,
  "src/server/notifier.ts": NOTIFIER_BUGGY,
  "src/server/avatars.ts": AVATARS_BASE,
  "src/server/buttondown.ts": BUTTONDOWN_BASE,
  "src/server/api.ts": API_BASE,
  "src/server/schema.ts": SCHEMA_BASE,
  "src/lib/supabase/client.ts": CLIENT_BASE,
  "src/app/members/page.tsx": MEMBERS_PAGE_BASE,
  "biome.jsonc": BIOME_BASE,
  "docs/design-buttondown.md": `# Buttondown sync

Program tags mirror to Buttondown on a cron. Write policy: the app is the source of truth;
Buttondown is write-only from our side. (Fixture stand-in.)
`,
};

// ---------------------------------------------------------------------------
// Eval-specific content.
// ---------------------------------------------------------------------------

const DRIFT_WORKFLOW_STUB = `name: skill-creator-drift
on:
  schedule:
    - cron: "0 6 1 * *" # monthly
  workflow_dispatch:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "drift check stub"
`;

const DRIFT_WORKFLOW_FULL = DRIFT_WORKFLOW_STUB.replace(
  '      - run: echo "drift check stub"',
  `      - run: node scripts/check-skill-drift.mjs
        # exit 0 = clean, 1 = drift (open issue), 2 = upstream restructure (manual re-vendor)`,
);

const DRIFT_SCRIPT = `#!/usr/bin/env node
// Compares the vendored skill-creator tree against upstream.
// Exit codes: 0 clean; 1 drift detected; 2 upstream restructured (manual re-vendor required).
console.log("check-skill-drift: fixture stub");
process.exit(0);
`;

const DRIFT_SCRIPT_TEST = `import { test } from "node:test";
import assert from "node:assert";

test("exit-code-2 path signals upstream restructure", () => {
  assert.ok(true); // covered by live test 2026-07-19
});
`;

const MORNING_HANDOFF_DOC = `# Hand-off: skill-creator vendoring PR 3 — drift-check workflow

**Updated:** 2026-07-19
**Source of truth:** docs/doc-skill-creator.md
**Tracker:** #396

---

## State as of 2026-07-19 (morning)

PR 3 design is finished: monthly drift-check workflow agreed. The workflow itself is drafted but
not implemented — no .github/workflows file exists yet on this branch.

## Gotchas / decisions learned this session

- Exit code 2 from the check script means upstream restructured; that needs a manual re-vendor,
  not an auto-PR.

## Uncommitted at hand-off

none — working tree clean.

## First step

\`\`\`powershell
git switch 396-pr3-drift
\`\`\`

1. Implement the workflow stub at .github/workflows/skill-creator-drift.yml.
2. Commit it and update this doc.
`;

const ROUNDTABLE_DOC = `# Roundtable: skill-creator drift-check cadence (PR 3)

**Date:** 2026-07-19 · **Participants:** Blake, Claude session

## Decision

Monthly scheduled drift-check workflow, not a per-PR check.

- **Why:** upstream skill-creator moves slowly; a per-PR job adds CI cost and noise for a change
  class that lands roughly monthly at most.
- **Alternatives considered:** per-PR check (rejected: noisy, expensive), quarterly manual check
  (rejected: forgettable, no owner).
- **Consequences:** drift is detected within a month; exit code 2 from the script signals an
  upstream restructure that needs a manual re-vendor, never an auto-PR.
- **Status:** final. Exit-code-2 path live-tested 2026-07-19.
`;

const MIGRATION_SQL = `-- expand step: add the new column alongside the old one (contract ships later)
ALTER TABLE "members" ADD COLUMN "status_v2" text NOT NULL DEFAULT 'active';
`;

const SCHEMA_EXPANDED = SCHEMA_BASE.replace(
  '  status: text("status").notNull().default("active"),',
  `  status: text("status").notNull().default("active"),
  statusV2: text("status_v2").notNull().default("active"),`,
);

const API_DUAL_WRITE = API_BASE.replace(
  '  .get("/members", (c) => c.json({ members: [] }));',
  `  .get("/members", (c) => c.json({ members: [] })) // read path: still old column only
  .post("/members/:id/status", (c) => c.json({ wrote: ["status", "status_v2"] }));`,
);

const MEMBERS_PAGE_WIP = MEMBERS_PAGE_BASE.replace(
  '      <ul data-testid="member-list" />',
  `      {/* WIP: status filter experiment */}
      <select data-testid="status-filter" />
      <ul data-testid="member-list" />`,
);

const BUTTONDOWN_BATCHED = `const BATCH_SIZE = 25;

export async function mirrorProgramTags(api: { setTags(email: string, tags: string[]): Promise<void> }, rows: { email: string; tags: string[] }[]) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((row) => api.setTags(row.email, row.tags)));
  }
}
`;

const BUTTONDOWN_WORKTREE = BUTTONDOWN_BATCHED.replace(
  "const BATCH_SIZE = 25;",
  `const BATCH_SIZE = 25;
// TODO(open question): does Buttondown's rate limit require backoff between batches?
const BATCH_DELAY_MS = 0;`,
);

const API_TAG_MIRROR_FIX = API_BASE.replace(
  '  .get("/members", (c) => c.json({ members: [] }));',
  `  .get("/members", (c) => c.json({ members: [] }))
  .post("/cron/buttondown-mirror", (c) => c.json({ mirrored: true, includesProgramTags: true }));`,
);

// ---------------------------------------------------------------------------
// gh stub responses.
// ---------------------------------------------------------------------------

const ghIssue = (n, title) => ({
  stdout: { number: n, title, state: "OPEN", url: `https://github.com/intentional-society/is-app/issues/${n}` },
  exit: 0,
});
const NO_PR = (branch) => ({ stderr: `no pull requests found for branch "${branch}"\n`, exit: 1 });
const GH_COMMON = { "auth status": { stdout: "github.com: logged in (fixture stub)\n", exit: 0 } };

const PR_489 = {
  stdout: {
    number: 489,
    url: "https://github.com/intentional-society/is-app/pull/489",
    title: "ci: monthly skill-creator drift check",
    state: "OPEN",
    reviewDecision: "REVIEW_REQUIRED",
    statusCheckRollup: [
      { name: "ci", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "e2e", status: "IN_PROGRESS", conclusion: "" },
    ],
  },
  exit: 0,
};

const PR_520 = {
  stdout: {
    number: 520,
    url: "https://github.com/intentional-society/is-app/pull/520",
    title: "feat(members): status expand migration + dual write path",
    state: "OPEN",
    reviewDecision: "REVIEW_REQUIRED",
    statusCheckRollup: [
      { name: "ci", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "e2e", status: "QUEUED", conclusion: "" },
    ],
  },
  exit: 0,
};

// ---------------------------------------------------------------------------
// Eval specs.
// ---------------------------------------------------------------------------

const EVAL_5_SPEC = {
  branch: "396-pr3-drift-workflow",
  commits: [
    {
      message: "feat(ci): add monthly skill-creator drift-check workflow",
      files: { ".github/workflows/skill-creator-drift.yml": DRIFT_WORKFLOW_FULL },
    },
    {
      message: "feat(ci): add drift-check script with exit-code contract",
      files: { "scripts/check-skill-drift.mjs": DRIFT_SCRIPT },
    },
    {
      message: "test(ci): cover the exit-code-2 restructure path",
      files: { "scripts/check-skill-drift.test.mjs": DRIFT_SCRIPT_TEST },
    },
  ],
  untracked: { ".scratch/pr3-drift-roundtable.md": ROUNDTABLE_DOC },
  gh: {
    ...GH_COMMON,
    "pr view": PR_489,
    "pr list": { stdout: "", exit: 0 },
    "issue view 396": ghIssue(396, "Vendor upstream skill-creator skill (PR 3: drift-check workflow)"),
  },
};

const EVALS = [
  {
    id: 1,
    name: "verify-over-memory",
    configs: ["with_skill", "old_skill"],
    branch: "486-notifier-retry-fix",
    worktree: { "src/server/notifier.ts": NOTIFIER_FIXED },
    gh: {
      ...GH_COMMON,
      "pr view": NO_PR("486-notifier-retry-fix"),
      "pr list": { stdout: "", exit: 0 },
      "issue view 486": ghIssue(486, "Notifier retry count double-increments on timeout"),
    },
  },
  {
    id: 2,
    name: "preserve-historical",
    configs: ["with_skill", "old_skill"],
    branch: "396-pr3-drift",
    commits: [
      {
        message: "feat(ci): add drift-check workflow stub",
        files: { ".github/workflows/skill-creator-drift.yml": DRIFT_WORKFLOW_STUB },
      },
    ],
    untracked: { ".scratch/drift-workflow-bootstrap.md": MORNING_HANDOFF_DOC },
    gh: {
      ...GH_COMMON,
      "pr view": NO_PR("396-pr3-drift"),
      "pr list": { stdout: "", exit: 0 },
      "issue view 396": ghIssue(396, "Vendor upstream skill-creator skill (PR 3: drift-check workflow)"),
    },
  },
  {
    id: 3,
    name: "nothing-in-flight",
    configs: ["with_skill"],
    branch: null,
    gh: { ...GH_COMMON, "pr view": NO_PR("main"), "pr list": { stdout: "", exit: 0 } },
  },
  {
    id: 4,
    name: "slash-minimal-parse",
    configs: ["with_skill", "old_skill"],
    branch: "486-notifier-retry-fix",
    commits: [
      { message: "fix(notifier): stop double-counting retries", files: { "src/server/notifier.ts": NOTIFIER_FIXED } },
    ],
    gh: {
      ...GH_COMMON,
      "pr view": NO_PR("486-notifier-retry-fix"),
      "pr list": { stdout: "", exit: 0 },
      "issue view 486": ghIssue(486, "Notifier retry count double-increments on timeout"),
    },
  },
  { id: 5, name: "slash-full-decision-log", configs: ["with_skill", "old_skill"], ...EVAL_5_SPEC },
  {
    id: 6,
    name: "nl-minimal-explicit",
    configs: ["with_skill", "old_skill"],
    branch: "chore/biome-rule-tweak",
    worktree: { "biome.jsonc": BIOME_BASE.replace('"noExplicitAny": "error"', '"noExplicitAny": "warn"') },
    gh: { ...GH_COMMON, "pr view": NO_PR("chore/biome-rule-tweak"), "pr list": { stdout: "", exit: 0 } },
  },
  {
    id: 7,
    name: "nl-compact-explicit-overrides",
    configs: ["with_skill", "old_skill"],
    branch: "512-buttondown-tag-mirror",
    commits: [
      {
        message: "fix(buttondown): batch tag-mirror calls in the cron",
        files: { "src/server/buttondown.ts": BUTTONDOWN_BATCHED },
      },
      {
        message: "fix(api): include program tags in the mirror endpoint",
        files: { "src/server/api.ts": API_TAG_MIRROR_FIX },
      },
    ],
    worktree: { "src/server/buttondown.ts": BUTTONDOWN_WORKTREE },
    gh: {
      ...GH_COMMON,
      "pr view": NO_PR("512-buttondown-tag-mirror"),
      "pr list": { stdout: "", exit: 0 },
      "issue view 512": ghIssue(512, "Buttondown tag mirror misses program tags"),
    },
  },
  {
    id: 8,
    name: "auto-escalate-full",
    configs: ["with_skill", "old_skill"],
    branch: "518-member-status-migration",
    commits: [
      {
        message: "feat(db): expand migration — add members.status_v2 alongside status",
        files: { "drizzle/0042_member_status_expand.sql": MIGRATION_SQL, "src/server/schema.ts": SCHEMA_EXPANDED },
      },
      {
        message: "feat(api): dual-write member status to old and new columns",
        files: { "src/server/api.ts": API_DUAL_WRITE },
      },
    ],
    worktree: { "src/app/members/page.tsx": MEMBERS_PAGE_WIP },
    gh: {
      ...GH_COMMON,
      "pr view": PR_520,
      "pr list": { stdout: "", exit: 0 },
      "issue view 518": ghIssue(518, "Member status enum migration (expand-contract)"),
    },
  },
  {
    id: 9,
    name: "compact-selective-expansion",
    configs: ["with_skill", "old_skill"],
    branch: "507-avatar-url-ttl",
    commits: [
      {
        message: "fix(avatars): raise signed-URL TTL to one hour",
        files: { "src/server/avatars.ts": AVATARS_TTL_FIXED },
      },
    ],
    worktree: {
      "src/server/avatars.ts": AVATARS_FOLLOWUP,
      "src/lib/supabase/client.ts": CLIENT_MYSTERY_EDIT,
    },
    gh: {
      ...GH_COMMON,
      "pr view": NO_PR("507-avatar-url-ttl"),
      "pr list": { stdout: "", exit: 0 },
      "issue view 507": ghIssue(507, "Avatar signed URLs expire too fast"),
    },
  },
  { id: 10, name: "nl-full-explicit", configs: ["with_skill", "old_skill"], ...EVAL_5_SPEC },
];

// ---------------------------------------------------------------------------
// gh stub files.
// ---------------------------------------------------------------------------

const GH_STUB_JS = `import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const dir = path.dirname(url.fileURLToPath(import.meta.url));
const responses = JSON.parse(fs.readFileSync(path.join(dir, "responses.json"), "utf8"));

const VALUE_FLAGS = new Set(["--json", "--jq", "-q", "--template", "--repo", "-R"]);
const raw = process.argv.slice(2);
const words = [];
for (let i = 0; i < raw.length; i++) {
  if (raw[i].startsWith("-")) {
    if (VALUE_FLAGS.has(raw[i])) i++;
    continue;
  }
  words.push(raw[i]);
}
const key = words.join(" ");
const match =
  responses[key] ??
  Object.entries(responses)
    .filter(([k]) => key.startsWith(k))
    .sort((a, b) => b[0].length - a[0].length)[0]?.[1];

if (!match) {
  process.stderr.write(\`gh (fixture stub): unsupported command: \${key}\\n\`);
  process.exit(1);
}
if (match.stdout !== undefined) {
  process.stdout.write(typeof match.stdout === "string" ? match.stdout : JSON.stringify(match.stdout, null, 2) + "\\n");
}
if (match.stderr) process.stderr.write(match.stderr);
process.exit(match.exit ?? 0);
`;

function writeGhStub(fixtureDir, responses) {
  const bin = join(fixtureDir, "fixture-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh-stub.mjs"), GH_STUB_JS);
  writeFileSync(join(bin, "responses.json"), JSON.stringify(responses, null, 2));
  writeFileSync(join(bin, "gh.cmd"), '@node "%~dp0gh-stub.mjs" %*\r\n');
  writeFileSync(join(bin, "gh"), '#!/bin/sh\nexec node "$(dirname "$0")/gh-stub.mjs" "$@"\n', { mode: 0o755 });
}

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

mkdirSync(root, { recursive: true });

for (const spec of EVALS) {
  const build = join(root, `_build-eval-${spec.id}`);
  rmSync(build, { recursive: true, force: true });
  const origin = join(build, "origin.git");
  const repo = join(build, "repo");
  mkdirSync(repo, { recursive: true });

  execFileSync("git", ["init", "--bare", "-b", "main", origin], { stdio: "pipe" });
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "pipe" });
  git(repo, "config", "user.name", "Fixture Bot");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "commit.gpgsign", "false");

  for (const [rel, content] of Object.entries(BASELINE_FILES)) write(repo, rel, content);
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "chore: baseline scaffold");
  git(repo, "remote", "add", "origin", "../origin.git");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "fetch", "-q", "origin");

  if (spec.branch) git(repo, "switch", "-q", "-c", spec.branch);
  for (const commit of spec.commits ?? []) {
    for (const [rel, content] of Object.entries(commit.files)) write(repo, rel, content);
    git(repo, "add", "-A");
    git(repo, "commit", "-m", commit.message);
  }
  for (const [rel, content] of Object.entries(spec.worktree ?? {})) write(repo, rel, content);
  for (const [rel, content] of Object.entries(spec.untracked ?? {})) write(repo, rel, content);
  writeGhStub(build, spec.gh);

  for (const config of spec.configs) {
    const dest = join(root, `eval-${spec.id}-${config}`);
    rmSync(dest, { recursive: true, force: true });
    cpSync(build, dest, { recursive: true });
  }
  rmSync(build, { recursive: true, force: true });
  process.stdout.write(`eval-${spec.id} (${spec.name}): ${spec.configs.join(", ")}\n`);
}

process.stdout.write(`\nFixtures built under ${root}\n`);
