# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Intentional Society web application — an authenticated app for a small, globally distributed membership network. Deployed at `app.intentionalsociety.org`.

## Commands

- `npm run dev` — start dev server (http://localhost:3000)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npx drizzle-kit generate` — generate SQL migrations from schema changes
- `npx drizzle-kit migrate` — apply migrations

## Architecture

The application stack is documented in `docs/architecture-appstack.md`. Key points:

- **Next.js 15** (App Router) serves the frontend and hosts the API via a catch-all route
- **Hono** handles all API logic, mounted inside Next.js at `src/app/api/[[...route]]/route.ts` — delegates to `src/server/api.ts`
- **Drizzle ORM** for type-safe Postgres access with forward-only SQL migrations (expand-contract pattern required). Schema at `src/server/schema.ts`, DB client at `src/server/db.ts`
- **Supabase** provides auth (JWT-based) and managed PostgreSQL — JWTs verified in Hono middleware, not via RLS
- **Supabase SSR** client helpers in `src/lib/supabase/` (server.ts, client.ts, middleware.ts) for cookie-based auth session management
- **TanStack Query** for client-side data caching/fetching (standalone, not paired with TanStack Router)
- **Tailwind CSS v4** for styling

Routing uses Next.js App Router exclusively. `typedRoutes: true` is enabled in `next.config.ts` for compile-time route checking. (Use Zod for runtime validation of dynamic route params and search params.)

The dev/test stack is documented in `docs/architecture-devstack.md`: Vitest, Playwright, MSW, Sentry, Axiom (via Vercel Log Drain).

A separate static www site (Gatsby on Netlify) is documented in `docs/architecture-www.md` and is not part of this repo.

## Database

- `DATABASE_URL` must use Supabase's **transaction pooler** (`aws-*.pooler.supabase.com:6543`), not the direct connection. Direct connections are IPv6-only and fail serverless environments including Vercel specifically.
- Migration running strategy is still TBD.

## Deployment

- **Platform**: Vercel (serverless Node.js functions, not edge — Drizzle/Postgres requires Node.js APIs)
- **Domain**: `app.intentionalsociety.org`
- **Env vars**: Set in Vercel dashboard (Settings → Environment Variables). See `.env.example` for required vars.
- **Auth emails**: Handled by Supabase directly (magic links, verification, password reset)
- **Framework preset**: Must be set to "Next.js" in Vercel project settings

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL          — Supabase project URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY — Supabase publishable/anon key
DATABASE_URL                      — Postgres connection string (transaction pooler)
```

## Development Journal

`docs/devjournal.md` records architecture and development decisions (most recent first). Add entries for non-obvious choices that future contributors or AI agents should know about. Format: `## YYYY-MM-DD | Author | Title` followed by description.

## Windows Notes

This project is developed on Windows. The `[[...route]]` catch-all directory requires Node.js to create (not shell commands) due to bracket characters in the path.
