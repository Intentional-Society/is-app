# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Intentional Society web application — an authenticated app for a small, globally distributed membership network. Deployed at `app.intentionalsociety.org`.

## Commands

- `npm run setup` — one-time: generate `.env.local` with local Supabase defaults (idempotent)
- `npm run dev` — start local Supabase (if needed) + dev server (http://localhost:3000)
- `npm run build` — production build
- `npm run lint` — Biome
- `npm test` — run all test suites (functional + e2e)
- `npm run test:functional` — Vitest only
- `npm run test:e2e` — Playwright only (Chromium, uses port 3093)
- `npm run watch` — Vitest watch mode
- `npm run dev:db:stop` — stop local Supabase containers
- `npm run dev:db:reset` — wipe local DB and reapply migrations
- `npx drizzle-kit generate` — generate SQL migrations from schema changes
- `npx drizzle-kit migrate` — apply migrations

## Architecture

Architecture specs in `docs/architecture-appstack.md` and `docs/architecture-devstack.md`.

- **Next.js 15** (App Router) serves the frontend and hosts the API via catch-all route
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

## Key docs

- `docs/strategy-branching.md` — branching strategy and rationale
- `docs/strategy-committing.md` — commit conventions and expand-contract pattern
- `docs/strategy-db-transactions.md` — writing transactions that survive the Supabase connection pooler
- `docs/strategy-project-management.md` — GitHub Projects board conventions
- `docs/strategy-security.md` — security headers and rationale for each directive
- `docs/strategy-ui.md` — theme tokens, the `/colors` dev page, Button variants, buttons vs anchors
- `docs/design-welcome.md` — multi-step onboarding/welcome flow design
- `docs/design-emails.md` — auth email template authoring and prod sync
- `docs/design-profile-pictures.md` — avatar uploads, storage bucket, signed URLs
- `docs/design-relations.md` — the relationship web (schema, flows, rationale)
- `docs/doc-vercel.md` — Vercel dashboard settings
- `docs/doc-supabase.md` — Supabase dashboard settings (auth URLs, API keys)
- `docs/doc-resend.md` — Resend transactional email (sending domain, DMARC, alternatives)
- `docs/doc-github.md` — GitHub settings and CI workflows
- `docs/doc-sentry.md` — Sentry error tracking and performance monitoring
- `docs/doc-axiom.md` — Axiom logging and Web Vitals
- `docs/setup-dev-machine.md` — system prerequisites (Node.js, Docker, etc.)
- `docs/devjournal.md` — development decision log (most recent first)
