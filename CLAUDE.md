# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Intentional Society web application — an authenticated app for a small, globally distributed membership network. This is a greenfield project; architecture specs exist but code scaffolding has not yet begun.

## Architecture

The application stack is documented in `docs/architecture-appstack.md`. Key points:

- **Next.js** (App Router) serves the frontend and hosts the API via a catch-all route
- **Hono** handles all API logic, mounted inside Next.js at `app/api/[[...route]]/route.ts` — this is the contract boundary for all clients
- **Drizzle ORM** for type-safe Postgres access with forward-only SQL migrations (expand-contract pattern required)
- **Supabase** provides auth (JWT-based) and managed PostgreSQL — JWTs are verified in Hono middleware, not via RLS
- **TanStack Query** for client-side data caching/fetching (standalone, not paired with TanStack Router)
- **Tailwind CSS** for styling
- **Hono RPC client** provides end-to-end type safety from API definition to frontend consumption

Routing uses Next.js App Router exclusively (no TanStack Router). Enable `typedRoutes: true` in `next.config.js` for compile-time route checking. Use Zod for runtime validation of dynamic route params and search params.

The dev/test stack is documented in `docs/architecture-devstack.md`: Vitest, Playwright, MSW, Sentry, Axiom (via Vercel Log Drain).

A separate static www site (Gatsby on Netlify) is documented in `docs/architecture-www.md` and is not part of this repo.

## Deployment

- **App**: Vercel (serverless Node.js functions, not edge — Drizzle/Postgres requires Node.js APIs)
- **Database migrations**: Run via CI (GitHub Actions) or manually before deploy, never at function startup
- **Auth emails**: Handled by Supabase directly (magic links, verification, password reset)

## Development Journal

`docs/devjournal.md` records architecture and development decisions. Add entries for non-obvious choices that future contributors or AI agents should know about. Format: `## YYYY-MM-DD | Author | Title` followed by description.
