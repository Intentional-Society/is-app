# Committing Strategy

## Before committing

If you touch code, have test coverage for it! Make sure you're keeping the docs and CLAUDE.md in sync with the state of the code as well.

If you've done work your teammates should know about, add a `docs/devjournal.md` entry (typically at a higher level than all the commit messages on that branch).

Run `npm test` (all suites) and confirm green before committing. Don't push code that you haven't tested locally. If you're changing frontend layout, check both phone and desktop rendering.

## Branch discipline

Always commit on a feature branch, never directly to `main`. PRs into `main` require CI to pass before merge.

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
