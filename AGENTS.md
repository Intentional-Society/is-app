# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository. Claude Code loads it through `CLAUDE.md`, which adds the Claude-specific instructions.

## Project Overview

Intentional Society web application — an authenticated app for a small, globally distributed membership network. Deployed at `app.intentionalsociety.org`.

## Commands

- `npm run setup` — one-time: generate `.env.local`, install Playwright Chromium, and apply local workflow setup (idempotent)
- `npm run make_lane_inside_worktree` — one-time: turn the current git worktree into an isolated parallel "lane" (own Supabase stack + ports); see `docs/strategy-worktree-lanes.md`
- `npm run dev` — start local Supabase (if needed) + dev server (http://localhost:3000)
- `npm run build` — production build
- `npm run lint` — Biome
- `npm test` — run all test suites (functional + e2e)
- `npm run test:functional` — Vitest only
- `npm run test:e2e` — Playwright only (Chromium); reuses a running dev server, else starts one on the dev port (3000, or the lane's `LANE_DEV_PORT`)
- `npm run watch` — Vitest watch mode
- `npm run dev:db:stop` — stop local Supabase containers
- `npm run dev:db:reset` — wipe local DB and reapply migrations
- `npx drizzle-kit generate` — generate SQL migrations from schema changes
- `npx drizzle-kit migrate` — apply migrations

## Architecture

Architecture specs in `docs/architecture-appstack.md` and `docs/architecture-devstack.md`.

- **Next.js 16** (App Router) serves the frontend and hosts the API via catch-all route
- **Hono** handles all API logic at `src/app/api/[[...route]]/route.ts`, defined in `src/server/api.ts`
- **Hono RPC client** (`apiClient` from `src/lib/api.ts`) provides type-safe API calls — use this instead of raw `fetch`
- **Drizzle ORM** for Postgres access. Schema at `src/server/schema.ts`, connection at `src/server/db.ts`
- **Supabase** provides auth (JWT) and managed PostgreSQL. Client helpers in `src/lib/supabase/`
- **TanStack Query** for client-side data caching
- **Tailwind CSS v4** for styling


## Local Development

Requires Docker Desktop. `npm run dev` auto-starts a local Supabase stack (Postgres on port 54322, Auth, Studio on 54323) via Docker, then launches Next.js. Supabase containers persist after Ctrl+C — use `npm run dev:db:stop` to shut them down.

## Database

**Production:** `DATABASE_URL` must use Supabase's **transaction pooler** (`aws-*.pooler.supabase.com:6543`), not the direct connection (IPv6-only, fails in most environments).

**Local:** `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Drizzle is the sole migration tool — do not use `supabase/migrations/`.

**Transactions:** a multi-statement `db.transaction(...)` over the transaction pooler can be silently mishandled — read `docs/strategy-db-transactions.md` before adding one.

**Raw SQL:** `db.execute` returns `timestamptz` as a string (Drizzle's Date mapping covers only the query builder) and rejects a bare JS `Date` parameter; bind an ISO string with `::timestamptz`.

**Migrations:** `drizzle-kit generate` emits `CREATE TABLE "auth"."users"` unless the latest snapshot carries `auth.users`; never let that statement reach `drizzle/*.sql`.

## Workflow

- Trunk-based development: feature branches PR into `main`, which auto-deploys to production
- Branch from a freshly fetched `origin/main`; rebase onto it when `main` moves.
- Run `npm test` (functional + e2e) before committing code; docs-only changes skip it. Keep docs, AGENTS.md and CLAUDE.md in sync with code changes.
- Each code push builds a Vercel preview and runs e2e against it; on a PR it also reruns ci.yml and claude-review. During review, commit locally and push once.
- Schema/API migrations use the **expand-contract pattern** (see `docs/strategy-committing.md`). Dispatch `prod:db:expand` before a schema PR merges, ideally before opening it: previews share the prod DB but skip migrations, so they 500 on unmigrated columns.
- Reference an issue whose fix is unconfirmed as "Addresses #N". "Fixes/Closes #N" in a merged title or commit auto-closes it.
- Hold a dependency back by adding it to its group's `exclude-patterns` in `.github/dependabot.yml`, with a comment saying why and what green looks like. Never use an `ignore` rule: the standalone weekly PR is the signal that upstream fixed it.
- All pushes trigger Vercel deployment; docs-only changes (defined in `scripts/docs-only.mjs`) skip automatically, on branches and on `main` (see `docs/strategy-committing.md`)
- Add `docs/devjournal.md` entries for decisions teammates should know about
- All first-party code must stick to **Baseline widely available** (`docs/strategy-browser-support.md`)

## CI/CD

- **ci.yml**: lint + functional tests on every PR (required to pass)
- **e2e.yml**: Playwright against Vercel preview URL, triggered by `deployment_status` event. Not a required GitHub check, but team policy requires it green before merging to `main`.
- Vercel auto-deploys `main` to production; the build command runs `drizzle-kit migrate` before `next build` on production deploys only (gated by `VERCEL_ENV`)
- `main`'s ruleset requires up-to-date branches: after one PR in a batch merges, each remaining PR needs `gh pr update-branch` and a fresh CI round.
- "Approve workflows to run" on a bot-opened PR (e.g. `chore/npm-audit-fix`) is not a review gate; approve it.
## Testing

- A flake is a bug: find and fix the root cause. A re-run is evidence for a diagnosis, never the fix.
- Capture a gate's real exit code (`cmd > log 2>&1; echo $?`, or `set -o pipefail`). Piping through `tail` masks failures. `gh pr checks --watch` can exit 0 with a failed check, so re-read `gh pr checks` afterward.
- A `23505` on a hardcoded fixture slug means parallel functional test files are racing; make the fixture unique per run.
- A slow new route that flakes the first e2e spec gets warmed in `tests/e2e/suite.setup.ts`; don't raise `TIMEOUT_MS`.
- A signed-in e2e spec sets `test.use({ user: "member" })` (or `"new-member"`, `"admin"`) and starts from a saved session; it never drives the sign-in form. Each Playwright worker owns one seeded account, so a value that must be unique across profiles (a slug) is built from `account.key`.
- Never pass a secret to `locator.fill` or type one under tracing: Playwright writes fill values into step titles and call arguments into traces, and CI uploads the report as a public artifact.
- For a failure that reproduces only on the Vercel preview, read the runtime log before bisecting dependencies.

## Production safety

- Never read `.env.prod` or other live-secret env files, even through a redacting pipe. Ask whether a key is set, or run the script that loads the file.
- Smoke-test a script only in a safe mode: `--dry-run`, a cleared credential variable (`SUPABASE_ACCESS_TOKEN= node …`), or a deliberately bad target. A loaded credential turns the destructive default into a real prod write.
- Run prod data operations one command at a time: state what it writes, wait for an explicit go-ahead, inspect the result before the next step. After a safety block, only an explicit "run it" authorizes a retry.

## Writing

- Docs and comments state what the code is and why it is shaped that way. Leave out the conversation that produced them, removed code and rejected alternatives. Tighten rationale comments rather than delete them.
- Commit and PR messages state the change and why it matters, without the path of discovery.
- Agents propose `docs/devjournal.md` entries in chat and add one to the file only after a human approves the wording.
- Changelog entries (`src/lib/changelog.tsx`): a 2–4 word title and a one-sentence description, no longer than the existing entries.
- **AI attribution:**
  - Commits: a `Co-Authored-By:` trailer with the bare model name and version, no patch level or variant suffix such as "(1M context)".
  - No session links or session trailers anywhere, even when the agent's tooling supplies them.
  - PR bodies need no attribution footer added; the commit trailers cover them.
  - Issue bodies end with `🤖 Filed by <agent>`, and issue and PR comments with `🤖 Written by <agent>`, where `<agent>` is a link to the tool. For example: `🤖 Written by [Claude Code](https://claude.com/claude-code)`.
- "The IS Web App" is the product and "Intentional Society" the organization. People in a program are "participants"; "members" means IS Web members generally.

## Key docs

- `docs/strategy-branching.md` — branching strategy and rationale
- `docs/strategy-worktree-lanes.md` — running parallel worktrees as isolated "lanes" (own Supabase stack + ports) for concurrent dev/test
- `docs/strategy-committing.md` — commit conventions and expand-contract pattern
- `docs/strategy-deployment.md` — continuous deployment during active sessions: Skew Protection, the tiered update banner, and the home safe-refresh
- `docs/strategy-db-transactions.md` — writing transactions that survive the Supabase connection pooler
- `docs/strategy-project-management.md` — GitHub Projects board conventions
- `docs/strategy-feature-development.md` — end-to-end feature pipeline: idea to quest reward (phases, gates, roles)
- `docs/strategy-security.md` — HTTP headers, supply-chain quarantine, dependency scanning policy, secret rotation
- `docs/strategy-browser-support.md` — three browser-support tiers: Baseline-widely-available full fidelity, best-effort down to the hard floor, legacy-check blocker below
- `docs/strategy-ui.md` — theme tokens, the `/colors` dev page, Button variants, buttons vs anchors
- `docs/design-welcome.md` — multi-step onboarding/welcome flow design
- `docs/design-emails.md` — auth email template authoring and prod sync
- `docs/design-profile-pictures.md` — avatar uploads, storage bucket, signed URLs
- `docs/design-programs.md` — programs and participants, plus program features (registry, attachment, access rule)
- `docs/feature-message-box.md` — the message box program feature: tables, who can read/post/delete, the prompt, routes
- `docs/design-relations.md` — the relationship web (schema, flows, rationale)
- `docs/design-buttondown.md` — Buttondown sync (program tag mirror, cron, write policy)
- `docs/design-richtext.md` — rich text: markdown storage, react-markdown render, MDXEditor authoring
- `docs/doc-vercel.md` — Vercel dashboard settings
- `docs/doc-supabase.md` — Supabase dashboard settings (auth URLs, API keys)
- `docs/doc-resend.md` — Resend transactional email (sending domain, DMARC, alternatives)
- `docs/doc-github.md` — GitHub settings and CI workflows
- `docs/doc-sentry.md` — Sentry error tracking and performance monitoring
- `docs/doc-axiom.md` — Axiom logging and Web Vitals
- `docs/doc-biome.md` — Biome lint/format config rationale and the version-bump policy
- `docs/doc-skill-creator.md` — the vendored upstream skill-creator skill (pin, refresh, evals)
- `docs/strategy-skill-evals.md` — running, extending and maintaining skill evals: the one rule, the eval schema, the exact commands, the runbooks. Start here for anything skill-related.
- `docs/design-skill-evals-harness.md` — the eval harness as built: module map and data flow, the safety/trust-boundary model, why it is shaped this way, the decision ledger, known gaps (with `spec-skill-evals-manifest.md` — the eval conversion manifest, pinned by the contract test)
- `docs/setup-dev-machine.md` — system prerequisites (Node.js, Docker, etc.)
- `docs/devjournal.md` — development decision log (most recent first)

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
