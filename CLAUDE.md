# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Intentional Society web application — an authenticated app for a small, globally distributed membership network. Deployed at `app.intentionalsociety.org`.

## Commands

- `npm run dev` — start dev server (http://localhost:3000)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm test` — run all test suites (functional + e2e)
- `npm run test:functional` — Vitest only
- `npm run test:e2e` — Playwright only (Chromium, uses port 3093)
- `npm run watch` — Vitest watch mode
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


## Database

`DATABASE_URL` must use Supabase's **transaction pooler** (`aws-*.pooler.supabase.com:6543`), not the direct connection (IPv6-only, fails in most environments).

## Workflow

- Trunk-based development: feature branches PR into `main`, which auto-deploys to production
- Run `npm test` before committing. Keep docs and CLAUDE.md in sync with code changes.
- Schema/API migrations use the **expand-contract pattern** (see `docs/doc-strategy-committing.md`)
- Docs-only changes skip Vercel deployment (configured in `vercel.json`)
- Add `docs/devjournal.md` entries for decisions teammates should know about

## CI/CD

- **ci.yml**: lint + functional tests on every PR (required to pass)
- **e2e.yml**: Playwright against Vercel preview URL, triggered by `deployment_status` event (not required, but check results before merging)
- Vercel auto-deploys `main` to production

## Key docs

- `docs/doc-strategy-branching.md` — branching strategy and rationale
- `docs/doc-strategy-committing.md` — commit conventions and expand-contract pattern
- `docs/doc-vercel.md` — Vercel dashboard settings
- `docs/doc-github.md` — GitHub settings and CI workflows
- `docs/devjournal.md` — development decision log (most recent first)
