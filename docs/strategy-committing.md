# Committing Strategy

## Before committing

If you touch code, have test coverage for it! Make sure you're keeping the docs and CLAUDE.md in sync with the state of the code as well.

If you've done work your teammates should know about, add a `docs/devjournal.md` entry (typically at a higher level than all the commit messages on that branch).

If you shipped something members can see or use, add an entry to the top of `src/lib/changelog.ts` — plain-language member-facing copy, distinct from the internal devjournal. It surfaces in the "Changelog" section of the `/about` page, and its date becomes the app version shown there.

Run `npm test` (all suites) and confirm green before committing. Don't push code that you haven't tested locally. If you're changing frontend layout, check both phone and desktop rendering.

**Watch out:** `git stash && <command>; git stash pop` looks like a safe way to test against a clean slate, but it isn't. `git stash` is a no-op when the tree is already clean — it does not push an empty marker — so the trailing `git stash pop` falls through to whatever was already on the stack, potentially applying leftover work from another branch. Instead, use `git stash list` to check the stack first, and only pop if you actually put something there.

## Branch discipline

Always commit on a feature branch, never directly to `main`. PRs into `main` require CI to pass before merge.

## Skipping deploys for docs-only changes

Every push to a branch with an open PR triggers a Vercel preview deploy, which eats build minutes. Vercel's `ignoreCommand` in `vercel.json` automatically skips builds whose entire branch diff vs `main` is confined to `docs/` or the root `CLAUDE.md`. Nothing for the author to remember.

How it works:

1. If the branch is `main`, deploy (production builds always run, including for docs-only merges, so the deploy record exists and migrations get a chance to run).
2. Otherwise, `git fetch --depth=1 "https://github.com/$VERCEL_GIT_REPO_OWNER/$VERCEL_GIT_REPO_SLUG.git" main` pulls main's tip into `FETCH_HEAD`. The explicit URL is necessary because Vercel's build container has no `origin` remote configured — `git fetch origin main` fails with `fatal: 'origin' does not appear to be a git repository`. The URL is reconstructed from the env vars Vercel exposes. This works without auth because the repo is public; if it ever goes private again, this fetch will need a token.
3. `git diff --quiet FETCH_HEAD HEAD -- . ':!docs/' ':!CLAUDE.md'` exits 0 if no non-docs files differ between this branch and main's tip, 1 if any do. We diff against `FETCH_HEAD` (rather than a named ref) because the fetch above doesn't create one — `git fetch <url> <branch>` populates only `FETCH_HEAD`.
4. The trailing `|| exit 1` normalises every failure path to exit 1 (deploy). Vercel's `ignoreCommand` only accepts exit codes 0 (skip) and 1 (deploy); anything else (e.g., `git fetch` exiting 128) is treated as a deployment failure, so we have to trap explicitly. `git fetch` errors are not redirected to `/dev/null` — if the next breakage is also a fetch issue, we want it visible in the Vercel build log.

Comparing against main's tip (rather than `VERCEL_GIT_PREVIOUS_SHA`) makes the skip work on the *first* push of a branch — which matters because trunk-based branches are usually short-lived and most PRs are single-push. It also handles mixed pushes correctly: any non-docs file in the branch's diff vs main triggers a deploy.

Failure modes all default to deploying (the safe direction):

- `git fetch origin main` fails (network, missing ref) — deploy runs.
- Anything unexpected — deploy runs.

Playwright e2e skips downstream because it's triggered by Vercel's `deployment_status` event, which only fires on a real deploy.

CI (lint + functional tests) is also skipped on docs-only PRs, but the mechanism differs from Vercel's. Branch protection requires the "Lint & Functional Tests" status check, so `ci.yml` can't simply not run — the check would stay stuck at "expected" and block merge. Instead it always runs, and the job itself decides whether to do any work: a `dorny/paths-filter` step sets a `code` output — true when the PR changes any file outside `docs/` and `CLAUDE.md` — and every subsequent step (Node and Supabase setup, `npm install`, `lint`, `typecheck`, migrations, the functional tests) is gated on `code == 'true'`. A docs-only PR skips them all and still reports success, satisfying branch protection.

## Schema and data migrations: expand-contract pattern

When a change touches the database schema or API response shape, deploy it in phases:

1. **Expand** — deploy a backend version that supports both the old and new shape. Add new columns/fields/endpoints alongside the old ones. Both old and new clients continue to work.
2. **Migrate** — update clients (frontend, mobile, etc.) to use the new shape. Deploy.
3. **Contract** — remove the old columns/fields/endpoints. Deploy.

Never combine an expand and a contract in a single deploy — that's the window where things break. How the phases map onto PRs is stack-specific: for our Drizzle setup, see "Running each phase on this stack" below.

### When migrations run

Database migrations run as part of Vercel's production build command (`vercel.json`): `drizzle-kit migrate` executes before `next build`, gated by `VERCEL_ENV=production` so preview deploys skip it. This guarantees the database schema is updated before the new code goes live.

Because migrations always run first, the only timing constraint to think about is:

- **The old code must tolerate the new schema** for the brief window between migration and deploy completion. In practice this is the easy direction — additive changes (new tables, new nullable columns) don't break existing queries.

The expand-contract pattern naturally satisfies this: the expand phase adds schema that the old code ignores, and the contract phase only removes schema that the new code no longer references.

**Preview caveat.** Preview deploys skip `drizzle-kit migrate` and share the production database, so they run new code against an un-migrated schema. Adding a column to `src/server/schema.ts` therefore breaks the branch's preview broadly: Drizzle expands every `db.select().from(table)` to all of the table's schema columns, so every select-all on that table 500s — not just code that reads the new column. (The page shows a generic "Application error"; the real `column "X" does not exist` is hidden in production builds.) Production itself wouldn't break — its build runs the migration before `next build` — but the preview stays broken until the schema is expanded with `npm run prod:db:expand` (see "Running each phase on this stack" below).

### Writing safe migrations

Every migration must be safe to run against a database that is actively serving requests with the *current* production code (i.e., the code from the previous deploy). Concretely:

- **Adding** tables, columns, or indexes is always safe.
- **Renaming or dropping** a column requires a full expand-contract cycle — don't drop until no deployed code references it.
- **`NOT NULL` without a default** on an existing table will fail if rows exist. Add the column as nullable (or with a default) first, backfill, then add the constraint in a follow-up migration.
- **Keep migrations fast.** Long-running locks on a small database are unlikely to cause problems today, but avoid patterns (like rewriting entire tables) that would become a problem at scale.

### Running each phase on this stack

**Expand can't be a schema-only PR.** Drizzle's schema is code: `db.select().from(profiles)` compiles to `SELECT <every column in the schema object>`. The moment you add a column to `src/server/schema.ts`, every select-all query enumerates it — there is no "schema only, no code" change. And since preview deploys skip `drizzle-kit migrate` and share the prod DB, such a PR selects a column prod doesn't have yet, so every page running a select-all 500s.

So the expand runs against the **database**, ahead of the code PR:

**Expand** — `npm run prod:db:expand` dispatches the `forward-migrate-prod-schema-expansion` workflow against your pushed branch. It pauses on a review gate — a maintainer approves before prod credentials are injected — then applies the branch's migration to the production database. This is safe ahead of merge because additive migrations only *add*: the currently deployed code enumerates only the columns it already knows, so a new one is invisible to it. (Expand-only for that reason — a drop or rename would break the still-running old code; those go through Contract.)

**Migrate** — a single PR that adds the column to `src/server/schema.ts`, commits the `npx drizzle-kit generate` output, and uses the column. Expand has already run, so the PR's preview and e2e hit a prod DB that has the column and pass. On merge, the production build's `drizzle-kit migrate` re-runs but the migration is already recorded — a no-op. (The textbook "Expand PR then Migrate PR" split collapses into this one PR, because there is no viable schema-only PR to separate out.)

**Contract** — removing old schema *can* be a clean PR: dropping a column from `schema.ts` makes select-all queries stop enumerating it, which is safe against a database that still has the column. The preview can't prove the drop is safe (prod still has the old schema), so the TypeScript compiler is the verification mechanism:

1. Remove the old column/table from `src/server/schema.ts`
2. Run `npx tsc --noEmit` — the compiler lists every stray reference to the removed schema
3. Fix each reference
4. Run `npx drizzle-kit generate` to produce the DROP migration
5. Reset the local DB (`npm run dev:db:reset`) and run `npm test` to confirm the whole suite passes against the contracted schema. This catches raw SQL or dynamic references the type checker can't see.
6. Merge. On production deploy, the DROP migration runs against a codebase the type checker has already proven doesn't reference the old schema.

This works because Drizzle's schema is TypeScript code, so removing a column turns "prove no code still uses this column" into a compile error — a much stronger signal than runtime monitoring or grep. Other stacks (Rails, SQLAlchemy) achieve similar safety by adding an intermediate deploy that marks the column as hidden from the ORM, but with Drizzle + TS we get it for free at build time.

## AI-assisted commits

We allow and encourage AI coding support, but you are responsible for the quality of both the code changes and the commit message. Commits made fully by AI assistance include a `Co-Authored-By` trailer for attribution and traceability.

### Conventional Commit style

Commit subjects (and PR titles, since PR titles become the merge commit subject per `merge_commit_title: PR_TITLE` in `docs/doc-github.md`) follow the [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) format:

`<type>[(scope)]: <imperative summary>`, **≤70 characters**.

Repo-observed types: `feat`, `fix`, `a11y`, `test`, `docs`, `chore`. Use the common CC types (`refactor`, `perf`, `ci`, `build`) when they fit. If several apply, pick the dominant intent.

Breaking changes get `!` before the colon AND a `BREAKING CHANGE:` footer in the body that explains the compatibility impact. Example: `feat!: remove deprecated profile.legacyId field`.

Commit body sections, in order: `Summary:` (one sentence), `Why:`, `Behavior:`, `Test Plan:`. Use plain bullets in `Test Plan:`, not Markdown task-list checkboxes — the body becomes the durable merge commit message (`merge_commit_message: PR_BODY`), and unchecked task boxes look like outstanding work. Don't add task-list checkboxes unless they already come from the PR template.

### AI co-author trailer

Every AI-authored commit (whether typed by hand from an AI suggestion or run via `/commit`) ends with a `Co-Authored-By:` trailer. Two paths:

- **Detection path (preferred).** When the agent can read its own model identity from runtime context, emit the canonical form: `Co-Authored-By: <Model Name> <Version> <noreply@anthropic.com>`. Example: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- **Fallback path (detection failed).** Ask the human once for the attribution string. Emit `Co-Authored-By: <human-provided string> <noreply@unspecified>` and append a one-line caveat to the commit body: `Note: AI co-author identity provided by human; auto-detection failed.`

v1 is Claude-only — no multi-vendor matrix.

### Related Skills

The `/commit` Skill (`.claude/skills/commit/SKILL.md`) encodes both rules above, plus the suspicious-file blocker, the combined-expand+contract refusal, and the single bundled human approval checkpoint.

**How to invoke.** `/commit` and `/pr` respond to a slash command (`/commit [issue-or-context]`) **or** to natural language ("commit this", "open a PR for this branch"). You can pass context either way: a PR link, an issue number (`/commit #142`), or plain-language guidance — including commit-splitting instructions like "commit these changes in multiple steps as follows: …". When invoked by natural language, the skill asks a one-tap intent confirmation (Step 0) before doing anything; explicit slash commands skip it. To turn the confirmation off on your machine, choose "Proceed and don't ask again" once (it creates the gitignored `.claude/skip-nl-confirm-commit-pr.local`), or delete that file to turn it back on — it skips only the intent confirmation, never the approval checkpoints. `/ship` is **explicit-only**: type `/ship` to merge; natural-language "ship it" will route you to type it. Full design: [plan-skill-nl-invocation.md](plan-skill-nl-invocation.md).
