# Committing Strategy

## Before committing

If you touch code, have test coverage for it! Make sure you're keeping the docs and CLAUDE.md in sync with the state of the code as well.

If you've done work your teammates should know about, add a `docs/devjournal.md` entry (typically at a higher level than all the commit messages on that branch).

Run `npm test` (all suites) and confirm green before committing. Don't push code that you haven't tested locally. If you're changing frontend layout, check both phone and desktop rendering.

## Branch discipline

Always commit on a feature branch, never directly to `main`. PRs into `main` require CI to pass before merge.

## Skipping deploys for docs-only changes

Every push to a branch with an open PR triggers a Vercel preview deploy, which eats build minutes. Vercel's `ignoreCommand` in `vercel.json` automatically skips builds whose entire branch diff vs `main` is confined to `docs/` or the root `CLAUDE.md`. Nothing for the author to remember.

How it works:

1. If the branch is `main`, deploy (production builds always run, including for docs-only merges, so the deploy record exists and migrations get a chance to run).
2. Otherwise, `git fetch --depth=1 origin main` pulls main's tip into `FETCH_HEAD`.
3. `git diff --quiet FETCH_HEAD HEAD -- . ':!docs/' ':!CLAUDE.md'` exits 0 if no non-docs files differ between this branch and main's tip, 1 if any do. We diff against `FETCH_HEAD` (rather than `origin/main`) because Vercel's clone is single-branch — its fetch refspec only tracks the deployed branch, so `git fetch origin main` populates `FETCH_HEAD` but never creates a `refs/remotes/origin/main` ref. Locally, full clones do create `origin/main`, which is why the `origin/main` form passes a local test and silently fails on Vercel.
4. The trailing `|| exit 1` normalises every failure path to exit 1 (deploy). Vercel's `ignoreCommand` only accepts exit codes 0 (skip) and 1 (deploy); anything else (e.g., `git fetch` exiting 128) is treated as a deployment failure, so we have to trap explicitly. `git fetch` errors are not redirected to `/dev/null` — if the next breakage is also a fetch issue, we want it visible in the Vercel build log.

Comparing against main's tip (rather than `VERCEL_GIT_PREVIOUS_SHA`) makes the skip work on the *first* push of a branch — which matters because trunk-based branches are usually short-lived and most PRs are single-push. It also handles mixed pushes correctly: any non-docs file in the branch's diff vs main triggers a deploy.

Failure modes all default to deploying (the safe direction):

- `git fetch origin main` fails (network, missing ref) — deploy runs.
- Anything unexpected — deploy runs.

Playwright e2e skips downstream because it's triggered by Vercel's `deployment_status` event, which only fires on a real deploy.

CI (lint + functional tests) still runs on every PR — branch protection requires its status check, and `paths-ignore` would leave the check stuck at "expected" and block merge. CI is cheap compared to Vercel's build minutes; the Vercel skip is where the savings come from.

## Schema and data migrations: expand-contract pattern

When a change touches the database schema or API response shape, deploy it in phases:

1. **Expand** — deploy a backend version that supports both the old and new shape. Add new columns/fields/endpoints alongside the old ones. Both old and new clients continue to work.
2. **Migrate** — update clients (frontend, mobile, etc.) to use the new shape. Deploy.
3. **Contract** — remove the old columns/fields/endpoints. Deploy.

Each phase is its own PR and deploy. Never combine expand and contract in a single deploy — that's the window where things break.

### When migrations run

Database migrations run as part of Vercel's production build command (`vercel.json`): `drizzle-kit migrate` executes before `next build`, gated by `VERCEL_ENV=production` so preview deploys skip it. This guarantees the database schema is updated before the new code goes live.

Because migrations always run first, the only timing constraint to think about is:

- **The old code must tolerate the new schema** for the brief window between migration and deploy completion. In practice this is the easy direction — additive changes (new tables, new nullable columns) don't break existing queries.

The expand-contract pattern naturally satisfies this: the expand phase adds schema that the old code ignores, and the contract phase only removes schema that the new code no longer references.

**Preview caveat.** Preview deploys skip the migration and share the prod DB, so a PR that both adds columns *and* reads them ships new code against the still-old preview database. Any page that queries the new columns will 500 ("Application error" in production builds — the real `column "X" does not exist` message is hidden). Production itself is unaffected because its build runs the migration before `next build`, but the preview can't exercise the new flow until the PR merges. To keep previews functional end-to-end, land the schema change in its own PR (Expand) before the PR that uses it (Migrate).

### Writing safe migrations

Every migration must be safe to run against a database that is actively serving requests with the *current* production code (i.e., the code from the previous deploy). Concretely:

- **Adding** tables, columns, or indexes is always safe.
- **Renaming or dropping** a column requires a full expand-contract cycle — don't drop until no deployed code references it.
- **`NOT NULL` without a default** on an existing table will fail if rows exist. Add the column as nullable (or with a default) first, backfill, then add the constraint in a follow-up migration.
- **Keep migrations fast.** Long-running locks on a small database are unlikely to cause problems today, but avoid patterns (like rewriting entire tables) that would become a problem at scale.

### Verifying each phase with this stack

Each phase is its own PR, merged and deployed before the next one opens. Here's how each phase gets verified:

**PR #1 (Expand)** — add the new schema to `src/server/schema.ts`, run `drizzle-kit generate` to produce the additive migration. No code changes (or only additive, backward-compatible ones). CI functional tests and the e2e preview both run cleanly because the old code still works against the new schema. On merge, the migration runs against prod and the schema is expanded.

**PR #2 (Migrate)** — update code to read/write the new schema. No schema or migration changes. By the time this PR opens, PR #1 has merged and the prod DB already has the new schema, so the e2e preview (which hits the prod DB) can exercise the new code paths against real data. CI functional tests pass because the tests can rely on the new schema being present locally after `npm run dev:db:reset`.

**PR #3 (Contract)** — this is the interesting one. The preview deploy hits a prod DB that *still has the old schema* (the contract migration hasn't run yet), so the preview can't verify that the drop is safe. Instead we use the TypeScript compiler as the verification mechanism:

1. Remove the old column/table from `src/server/schema.ts`
2. Run `npx tsc --noEmit` — the compiler lists every stray reference to the removed schema
3. Fix each reference. (Most should already be gone from PR #2 — this step catches stragglers, including anything in code paths that weren't touched by PR #2.)
4. Run `npx drizzle-kit generate` to produce the DROP migration
5. Reset the local DB (`npm run dev:db:reset`) and run `npm test` to confirm the whole suite passes against the contracted schema. This catches raw SQL or dynamic references the type checker can't see.
6. Merge. On production deploy, the DROP migration runs against a codebase the type checker has already proven doesn't reference the old schema.

This works because Drizzle's schema is TypeScript code, so removing it from the schema turns "prove no code still uses this column" into a compile error — a much stronger signal than runtime monitoring or grep. Other stacks (Rails, SQLAlchemy) achieve similar safety by adding an intermediate deploy that marks the column as hidden from the ORM, but with Drizzle + TS we get it for free at build time.

## AI-assisted commits

We allow and encourage AI coding support, but you are responsible for the quality of both the code changes and the commit message. Commits made fully by AI assistance include a `Co-Authored-By` trailer for attribution and traceability.
