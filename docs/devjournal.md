# Development Journal

Each entry: **Date** | **Author** | **Title**, followed by description text. Most recent first.

---

## 2026-04-23 | Blake | `.env.local.example` as single source of truth + preflight drift check

The local-dev env template used to live as a string literal inside `scripts/setup.mjs`, and `ensureLocalEnv` was "create `.env.local` if missing, otherwise leave it alone." That's fine until the template grows — `.env.local` is gitignored, so existing devs silently keep stale files. We hit this when adding the e2e auth vars (`SUPABASE_SECRET_KEY`, `E2E_*_PASSWORD`, `CI_RESET_TOKEN`): old `.env.local` files kept working for `npm run dev` but blew up ten layers deep in Playwright setup with errors like "CI_RESET_TOKEN is required to run the e2e suite."

The fix is the standard `.env.local.example` pattern with a twist. `.env.local.example` is now committed as the canonical key list (values are the deterministic Supabase-CLI defaults plus non-sensitive local passwords, same as before). `scripts/setup.mjs` simplified to a `copyFileSync`. New `scripts/check-env.mjs` runs as the first step of `npm run dev:db` and diffs keys — if `.env.local` is missing anything declared in `.env.local.example`, it fails with the exact missing keys and the fix. Because every dev/test entry point (`npm run dev`, `npm run test:functional`, `npm run test:e2e`, `npm test`) chains through `dev:db`, the check runs everywhere for free.

Workflow when adding a new env var going forward: add the key + local default to `.env.local.example`, and every existing dev gets a clear, actionable error on their next `npm run dev` instead of a mystery test failure. Values in `.env.local` are never touched — devs are free to override locally.

## 2026-04-22 | James | Skip Vercel preview for docs-only changes

Vercel's `ignoreCommand` now diffs HEAD against the previous successful deploy and skips the build when only `docs/` or root `CLAUDE.md` changed. See `docs/doc-strategy-committing.md`.

## 2026-04-21 | Ola | Seed script for local development

Added `npm run seed:dev` to populate a fresh local database with believable test data — 15 member profiles, 3 programs (The Gumball Machine, Presence Pods, Thematic Crews), memberships spread realistically across them, and 5 redeemed invites that trace a real invite chain. All IDs are fixed so E2E tests can reference known values. Running it twice does nothing harmful.

One thing worth knowing: creating auth users in the seed script turned out to be trickier than expected. The `profiles` table has a foreign key to Supabase's `auth.users`, so you can't just insert profiles directly. The obvious approach — using the Supabase Admin API with the service-role key — broke when we found the new Supabase CLI (v2.89+) moved away from JWT keys to a new `sb_secret_*` format that the JS client couldn't parse. Ended up inserting directly into `auth.users` via the postgres superuser connection instead, which is simpler and doesn't care about key formats.

## 2026-04-20 | James | Auth Phase 3 (invites) complete

Member-generated invites are live. Any signed-in member mints a 10-char code (31-char alphabet — A–Z minus I/O, 2–9 minus 0/1) from `/`, with a 10-active-per-member cap, a 30-day expiry, and a required note that travels with the invite. `/signup` is the new front door: enter code → public `GET /api/invites/:code/check` surfaces the inviter's note (so the visitor recognises what the code is for) → enter email + display name → magic link goes through `/auth/callback?invite=<code>`.

Redemption is atomic inside `/auth/callback`: a single transaction inserts the profile row, runs the guarded `UPDATE invites SET redeemed_by = …` (active predicates plus Postgres row locking serialise concurrent redeemers), then stamps `referredBy`. If the UPDATE returns 0 rows the whole transaction rolls back, the session is signed out, and the visitor lands on `/login?error=invite_invalid`. The profile-first ordering is forced by the `invites.redeemed_by → profiles.id` FK — only a single transaction can satisfy both constraints cleanly.

Playwright can finally drive signed-in flows. The Phase 3a session helper provisions a test user via the Supabase Admin API, signs in through the real login form, and tears the user down (profile row first, since the FK has no cascade). The Phase 2 welcome e2e is backfilled in the same PR.

## 2026-04-19 | James | Auth Phase 2 (profile expansion) complete

`profiles` grew from three columns to the full community shape (bio, keywords, location, supplementaryInfo, referred-by, avatar, emergency contact, live desire, isAdmin) via additive `ALTER TABLE`s. `programs` and `profilePrograms` landed as empty structural tables — deliberately **not** joined into any profile shape; program membership will get its own endpoint.

Introduced serialization-layer access control: `getProfileForSelf` returns the full self view; `getProfileForMember` / `getProfileForAdmin` are `NotImplemented` stubs so the next person adding a directory or admin surface is forced to decide the visible shape rather than silently reusing self. `PUT /api/me` accepts only the editable subset and rejects unknown or privileged keys (`isAdmin`, `referredBy`, etc.) via a compact allowlist parser — no new validation dep.

`/welcome` is the first-sign-in completion flow: `/` redirects there when `bio IS NULL`, and the form saves via `PUT /api/me` plus an optional client-side `supabase.auth.updateUser({ password })`. Login grew an optional password field; blank still sends a magic link, which is also the recovery path (no "forgot password" link). Signed-in e2e coverage is deferred to Phase 3, which owns the Playwright session-minting helper.

## 2026-04-18 | James | Auth Phase 1 (plumbing) complete

End-to-end magic-link auth is wired. `/` is now a protected server component (unauthed → `/login`), the Hono API gates every route except `/api/health`, and `/api/me` returns a strict `{ id, email, profile }` shape that the functional test locks down so Phase 2's sensitive-field additions can't silently leak.

## 2026-04-14 | James | Drizzle migrations run in Vercel production build

Every production deploy now runs `drizzle-kit migrate` before `next build` (gated on `VERCEL_ENV=production` in `vercel.json`), and a failed migration aborts the deploy with the previous build still serving traffic. Preview deploys skip the migration and continue to hit the prod DB unchanged. See `docs/doc-strategy-committing.md` for the expand-contract verification recipe that builds on this guarantee.

## 2026-04-07 | James | Observability: Sentry + Axiom

Sentry for error tracking, performance traces, and session replay. Axiom for structured request logs via Vercel Log Drain + next-axiom. Hono middleware logs method, path, status, and duration on every API request.

## 2026-04-06 | James | Local dev environment via Supabase CLI + Docker

`npm run dev` now auto-starts a local Supabase stack (Postgres, Auth, Studio) in Docker and runs Drizzle migrations. Each developer gets an isolated database. Drizzle is the sole migration tool — we don't use `supabase/migrations/`. Production still uses the hosted Supabase instance via env vars.

## 2026-04-05 | James | Testing and CI setup

Vitest for functional tests, Playwright for e2e browser tests. GitHub Actions CI runs lint + functional tests on every PR, then runs Playwright against the Vercel preview URL. Hono RPC client (`apiClient`) wired up for type-safe API calls from the frontend.

## 2026-04-04 | James | First end-to-end deployment live

App deployed to Vercel at `app.intentionalsociety.org`. Stack verified working: Next.js serving pages, Hono API responding at `/api/*`, Drizzle querying Supabase Postgres via transaction pooler. Supabase SSR client helpers set up for future auth flows (server/client/middleware pattern using `@supabase/ssr`).

## 2026-04-04 | James | Supabase Postgres requires transaction pooler for IPv4 + serverless

Supabase direct database connections resolve to IPv6 only (AWS stopped offering free IPv4 addresses). Local development and Vercel serverless functions may not route IPv6 properly. The fix is to use Supabase's **Transaction Pooler** connection string (`aws-*.pooler.supabase.com:6543`) which provides IPv4 and is also the correct choice for serverless environments where connections don't persist between invocations.

`DATABASE_URL` should always point to the transaction pooler, not the direct connection.

## 2026-04-04 | James | Enable Next.js typedRoutes for compile-time route safety

After dropping TanStack Router in favor of Next.js's built-in App Router, we lose compile-time type-safe route params and search params. The mitigation is two-fold:

1. **`typedRoutes: true`** in `next.config.js` — Next.js generates route type definitions in `.next/types` so that `<Link href="...">`, `push()`, `replace()`, and `prefetch()` all get compile-time checking of route paths. A typo in a route string becomes a TypeScript error. Zero dependencies, one line of config.

2. **Zod validation** for dynamic route params and search params inside page components. This is runtime, not compile-time, but it catches malformed URLs from external sources that no static check can cover.

Together these cover ~90% of what TanStack Router's type safety provided without adding a routing library alongside Next.js's own.
