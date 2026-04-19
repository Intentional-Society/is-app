# Development Journal

Each entry: **Date** | **Author** | **Title**, followed by description text. Most recent first.

---

## 2026-04-19 | James | Auth Phase 2 (profile expansion) complete

`profiles` grew from three columns to the full community shape (bio, keywords, location, supplementaryInfo, referredBy, referredByLegacy, avatarUrl, emergencyContact, liveDesire, isAdmin) via additive `ALTER TABLE` statements — no backfill needed because the only existing row was a test account. `programs` and `profilePrograms` also landed as empty structural tables; they were deferred from Phase 1 and explicitly **not** joined into any profile shape, because program membership is a separate concern that will get its own endpoint.

Introduced the serialization-layer access control pattern: `getProfileForSelf` returns the full self view (including `emergencyContact` and `isAdmin`), and `getProfileForMember` / `getProfileForAdmin` are `NotImplemented` stubs. The stubs exist deliberately so the next person to build a member-directory or admin tool is forced to decide the visible shape rather than silently reusing self.

`PUT /api/me` accepts only the editable subset (bio, keywords, location, supplementaryInfo, avatarUrl, emergencyContact, liveDesire). Unknown keys and non-editable fields (`isAdmin`, `referredBy`, `displayName`, `id`, `createdAt`) are rejected with 400 by a compact allowlist parser — no new validation dependency.

`/welcome` was added as the first-sign-in completion flow: `/` redirects there when `profile.bio IS NULL`, and the form saves via `PUT /api/me` plus an optional client-side `supabase.auth.updateUser({ password })`. Login page grew an optional password field; blank password still sends a magic link. No "forgot password" link — magic link is the recovery path.

Signed-in e2e coverage for the welcome flow is deliberately deferred to Phase 3, which owns the Playwright session-minting helper. The login-page password-vs-OTP e2e uses route interception on `/auth/v1/token` and `/auth/v1/otp` — no session needed because `/login` is public.



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
