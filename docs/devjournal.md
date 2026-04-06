# Development Journal

Each entry: **Date** | **Author** | **Title**, followed by description text. Most recent first.

---

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
