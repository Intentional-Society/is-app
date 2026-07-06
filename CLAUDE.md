# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

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

## Workflow

- Trunk-based development: feature branches PR into `main`, which auto-deploys to production
- Run `npm test` before committing. Keep docs and CLAUDE.md in sync with code changes.
- Schema/API migrations use the **expand-contract pattern** (see `docs/strategy-committing.md`)
- All pushes trigger Vercel deployment; docs-only changes (`docs/**`, root `CLAUDE.md`) skip automatically (see `docs/strategy-committing.md`)
- Add `docs/devjournal.md` entries for decisions teammates should know about

## CI/CD

- **ci.yml**: lint + functional tests on every PR (required to pass)
- **e2e.yml**: Playwright against Vercel preview URL, triggered by `deployment_status` event. Not a required GitHub check, but team policy requires it green before merging to `main`.
- Vercel auto-deploys `main` to production; the build command runs `drizzle-kit migrate` before `next build` on production deploys only (gated by `VERCEL_ENV`)

## AI Skills

Three Claude Code Skills live at `.claude/skills/` and encode the team's check-in workflow. `/commit` and `/pr` are invocable by slash command **or** natural language ("commit this", "open a PR") — **this includes the case where *you* offered to commit or open a PR and the human merely affirms ("yes", "go ahead", "do it"): that affirmation is the trigger.** (Only an affirmation of *your own commit/PR offer* counts — a "yes" to an unrelated offer like a refactor, rename, or search is **not** a trigger; don't fire the Skill on it.) Route every commit/PR intent through the Skill via the `Skill` tool; never hand-roll the commit or PR with ad-hoc `git`/`gh`. On **every** natural-language (model-invoked) run, **announce `Using /commit` or `Using /pr` as you route — the first line of the message in which you call the `Skill` tool, before the call** — so the human can see which Skill fired (an ad-hoc commit can't honestly print it; announcing at the routing decision, not waiting until inside the Skill, is what makes it reliable). **When a Skill delegates (`/ship` → `/pr` → `/commit`), the parent announces the handoff** (`Using /commit — delegated from /pr`); the delegated child does not re-announce. On the natural-language path the Skills also confirm intent first (Step 0) unless `.claude/skip-nl-confirm-commit-pr.local` exists (the confirmation offers a "don't ask again" option that creates that per-machine opt-out file); the announcement still fires even when that confirmation is skipped. `/ship` is explicit-only (`disable-model-invocation: true`): on ship/merge intent, ask the human to type `/ship` — never run or simulate the merge workflow yourself.

- `/commit [issue-or-context]` — stage, run `npm test`, draft a Conventional Commit-style message, bundled human approval, push. See [.claude/skills/commit/SKILL.md](.claude/skills/commit/SKILL.md).
- `/pr [PR#|URL|issue-or-context]` — fetch + rebase if main moved, push, open or update the PR. Does not watch CI. See [.claude/skills/pr/SKILL.md](.claude/skills/pr/SKILL.md).
- `/ship [PR#|URL|issue-or-context]` — orchestrates `/pr` (which orchestrates `/commit`), waits for CI green, merges via `gh pr merge --merge --delete-branch`, watches `main` for 5 minutes post-merge. See [.claude/skills/ship/SKILL.md](.claude/skills/ship/SKILL.md).

Design and rationale: [docs/spec-portable-ai-procedures.md](docs/spec-portable-ai-procedures.md); natural-language-invocation design: [docs/plan-skill-nl-invocation.md](docs/plan-skill-nl-invocation.md).

A fourth skill, Anthropic's upstream `skill-creator` (used to build and eval the Skills above; model-invokable like `/commit` and `/pr` — only `/ship` is explicit-only), is vendored verbatim at `.claude/skills/skill-creator/`, pinned to an upstream commit. Check/refresh via `node scripts/update-skill-creator.mjs --check`. See [docs/doc-skill-creator.md](docs/doc-skill-creator.md).

> **TODO (memory for Blake): make `/commit`, `/pr`, `/ship` work 100% in cloud Claude Code (web) sessions without `gh`.** These Skills currently assume the `gh` CLI *and* an interactive human-approval channel, neither of which exists in a cloud/web session — there `gh` is absent and GitHub work goes through the GitHub MCP server (`mcp__github__*`), with no synchronous "bundled approval" prompt available. Symptom that prompted this: in a web session the throwaway-PR scripts (`scripts/new-throwaway-pr.{ps1,py,sh}`, `docs/devjournal.md` 2026-07-06) had to be committed with ad-hoc `git` because routing through `/commit` would have failed on both counts. Fix direction: teach each Skill to detect the environment and, when `gh` is unavailable, use the MCP GitHub tools for PR create/merge/close; and define a non-interactive approval path for cloud (e.g. `AskUserQuestion`, or an explicit opt-out) so the approval checkpoints still mean something. Keep the local/`gh` path unchanged. Revisit the `scripts/*` git-vs-Skill note in the throwaway-PR replies once this lands.

## Key docs

- `docs/strategy-branching.md` — branching strategy and rationale
- `docs/strategy-worktree-lanes.md` — running parallel worktrees as isolated "lanes" (own Supabase stack + ports) for concurrent dev/test
- `docs/strategy-committing.md` — commit conventions and expand-contract pattern
- `docs/strategy-deployment.md` — continuous deployment during active sessions: Skew Protection, the tiered update banner, and the home safe-refresh
- `docs/strategy-db-transactions.md` — writing transactions that survive the Supabase connection pooler
- `docs/strategy-project-management.md` — GitHub Projects board conventions
- `docs/strategy-security.md` — security headers and rationale for each directive
- `docs/strategy-ui.md` — theme tokens, the `/colors` dev page, Button variants, buttons vs anchors
- `docs/design-welcome.md` — multi-step onboarding/welcome flow design
- `docs/design-emails.md` — auth email template authoring and prod sync
- `docs/design-profile-pictures.md` — avatar uploads, storage bucket, signed URLs
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
- `docs/setup-dev-machine.md` — system prerequisites (Node.js, Docker, etc.)
- `docs/devjournal.md` — development decision log (most recent first)
