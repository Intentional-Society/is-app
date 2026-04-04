# Development Journal

Each entry: **Date** | **Author** | **Title**, followed by description text.

---

## 2026-04-04 | James | Enable Next.js typedRoutes for compile-time route safety

After dropping TanStack Router in favor of Next.js's built-in App Router, we lose compile-time type-safe route params and search params. The mitigation is two-fold:

1. **`typedRoutes: true`** in `next.config.js` — Next.js generates route type definitions in `.next/types` so that `<Link href="...">`, `push()`, `replace()`, and `prefetch()` all get compile-time checking of route paths. A typo in a route string becomes a TypeScript error. Zero dependencies, one line of config.

2. **Zod validation** for dynamic route params and search params inside page components. This is runtime, not compile-time, but it catches malformed URLs from external sources that no static check can cover.

Together these cover ~90% of what TanStack Router's type safety provided without adding a routing library alongside Next.js's own.
