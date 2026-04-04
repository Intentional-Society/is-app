# Intentional Society Application — Development & Testing Stack

**Context:** Development tooling, testing infrastructure, and observability for the Intentional Society  application.

---

### GitHub — Repository Hosting & CI/CD

**What it does:** Hosts the application source code repository. Provides pull request workflows, code review, and GitHub Actions for continuous integration (running tests, linting, database migrations) and continuous deployment (triggering Vercel builds).

**Connects to:** Vercel (automatic deploys on push to main, preview deploys on PR branches), GitHub Actions runners (execute CI pipelines), Supabase (migrations run from CI against staging/production databases).

**Why this choice:** GitHub is the default for open-source and small-team projects. Vercel's GitHub integration is first-party — connect the repo once and every push triggers a build with zero configuration. GitHub Actions provides CI/CD runners with a generous free tier (2,000 minutes/month for free accounts, 3,000 for Pro). The Actions marketplace has pre-built steps for Node.js setup, Playwright browser caching, and Supabase CLI operations.

For this project, Actions handles: running Vitest and Playwright on every PR, running Drizzle migrations against a staging database before deploy, and potentially running migrations against production as a post-deploy step. Playwright tests benefit from Actions' ability to cache browser binaries across runs, reducing CI time from ~90 seconds of browser installation to near-zero on subsequent runs.

**Known downsides:** GitHub Actions runners are shared infrastructure — occasional queue delays during peak times. The free tier's 2,000 minutes is generous for a small project but Playwright tests with multiple browsers consume minutes faster (each browser is a separate test shard). For cost control, run Playwright against Chromium only in PR checks and against all browsers on merge to main. Self-hosted runners are available if the free tier is ever insufficient, but unlikely to be needed at this project's scale.

---

### TypeScript - Language

**What it does:** Statically typed superset of JavaScript used across the entire stack — React components, Hono API handlers, Drizzle schemas, test files. Provides compile-time error checking, IDE autocompletion, and refactoring safety.

**Why this choice:** TypeScript is the default for professional JavaScript development in 2026. The ecosystem assumes it. The entire stack (Hono, Drizzle, TanStack Router, TanStack Query) is designed TypeScript-first, with types flowing from database schema to API response to UI component without manual annotation.

---

### Vite — Build Tool (via Next.js)

**What it does:** Fast JavaScript bundler and development server. Handles TypeScript/JSX transpilation, CSS processing (modules, Tailwind), hot module replacement (HMR), code splitting, tree-shaking, and production minification. Next.js uses Turbopack (a Vite-inspired tool) for development, but Vite is the underlying paradigm.

**Why this choice:** Vite replaced Webpack as the standard build tool. Sub-50ms HMR, native TypeScript support without configuration, built-in CSS modules and PostCSS, and production builds via Rolldown (Rust-based, 10–30x faster than Rollup). If the project ever extracts a standalone SPA or Hono API server, Vite is the direct build tool.

---

### Vitest — Unit & Integration Test Runner

**What it does:** Runs unit tests for business logic, utility functions, React hooks, and Hono API route handlers. Jest-compatible API with native Vite integration — picks up the project's Vite config automatically.

**Connects to:** Hono (API handler tests import the app directly), React components (component tests via vitest-browser-react or Testing Library), MSW (shared mock handlers).

**Why this choice:** Vitest is the standard test runner for Vite-based projects. It's fast (parallel execution, native ESM), has built-in TypeScript support, and provides a familiar Jest-like API. API tests can call Hono's `app.request()` directly without spinning up an HTTP server, making them fast and isolated.

---

### Mock Service Worker (MSW) — API Test Doubles

**What it does:** Intercepts network requests at the service worker level and returns mock responses. Defines API behavior using standard Fetch API syntax. The same handler definitions work across Vitest component tests, Playwright E2E tests, Storybook stories, and local development.

**Connects to:** Vitest (component tests with mocked API), Playwright (E2E tests with mocked or replayed API), Storybook (component development with mock data), Hono API (handlers mirror real API shape).

**Why this choice:** MSW is the "replay server" pattern implemented as an industry standard. Write API mock handlers once, reuse them everywhere. No actual HTTP server to run. Handlers can be overridden per-test to simulate error states, slow responses, or edge cases. The official `@msw/playwright` integration provides clean fixtures for Playwright tests. This replaces the need for a separate test double server while keeping frontend tests decoupled from the real API.

**Known downsides:** MSW's service worker approach can conflict with Playwright's `page.route()` — the `@msw/playwright` package resolves this by using `page.route()` under the hood. Handlers must be maintained in sync with actual API changes (mitigated by sharing TypeScript types from the Hono API).

---

### Playwright — End-to-End Testing

**What it does:** Automates real browser interactions for testing complete user flows — login, join a group, update a profile, navigate between pages. Runs tests against Chromium, Firefox, and WebKit. Provides built-in tracing (screenshots + DOM snapshots at every step), auto-waiting, parallel execution, and network interception.

**Connects to:** MSW (API mocking for most tests), Next.js dev server or preview deployment (the application under test), Vitest (can share test utilities and mock definitions).

**Why this choice:** Playwright replaced Selenium as the standard E2E testing tool. It's faster, less flaky, natively supports modern SPAs, and has a locator API that finds elements the way users see them (`getByRole`, `getByText`) rather than brittle CSS selectors. Built-in HAR recording (`page.routeFromHAR()`) provides literal API replay from recorded traffic. The Trace Viewer makes debugging failed CI tests straightforward — you see exactly what the browser showed at each step.

**Known downsides:** E2E tests are inherently slower than unit tests — run them on critical paths and in CI, not on every save. Playwright tests require a running application (dev server or deployed preview). Browser installation adds to CI setup time (cached after first run).

---

### Storybook — Component Development & Visual Testing (Optional)

**What it does:** Provides an isolated environment for developing and visually inspecting React components in various states. Each component gets "stories" that render it with different props, data, and edge cases. Can be combined with visual regression testing tools to screenshot and diff components across commits.

**Connects to:** React components (renders them in isolation), MSW (mocks API calls within stories), Tailwind (styles render as in production).

**Why this choice:** Storybook is the standard for component-driven development. It serves as living documentation of UI components, enables visual QA without running the full application, and catches rendering regressions that unit tests miss. For a project with multiple contributors or long gaps between development sessions, Storybook provides a visual inventory of what exists and how it looks.

**Known downsides:** Configuration overhead — Storybook has its own build system and can be fiddly to align with the project's Vite/Next.js config. Maintenance burden if stories fall out of sync with components. For a solo developer, the cost-benefit may not justify the setup until the component library reaches meaningful size. Listed as optional for this reason.

---

### Sentry — Error Tracking & Performance Monitoring

**What it does:** Captures unhandled errors in both the Hono API (server-side) and the React application (client-side) with stack traces, request context, and breadcrumbs. Provides transaction tracing for identifying slow API routes and database queries.

**Connects to:** Hono (server SDK middleware), React (browser SDK), Vercel (source map upload for readable stack traces).

**Why this choice:** Sentry is the dominant error tracking service for JavaScript applications. The free tier is generous for small projects. It provides the "why" behind errors that Vercel's built-in monitoring doesn't surface — full stack traces, user context, and the sequence of events leading to a crash. Most serious Vercel users add Sentry regardless of what Vercel's dashboard shows.

**Known downsides:** Another third-party dependency. Adds a small amount of bundle size to the client. The dashboard can be noisy without tuning alert rules and error grouping.

---

### Axiom — Structured Log Storage & Query (via Vercel Log Drain)

**What it does:** Stores, indexes, and makes queryable all logs from Vercel serverless functions. Hono middleware writes structured JSON to stdout via `console.log()` (method, path, status, duration, userId). Vercel captures that output and streams it to Axiom automatically via its Log Drain pipeline. Axiom provides a query language for filtering, dashboards, and 30-day retention on the free tier (500GB monthly ingest).

**Connects to:** Vercel (Log Drain integration — zero-config from the Vercel marketplace), Hono (structured console output from request middleware), Sentry (complements error tracking — Sentry is reactive "what broke," Axiom is proactive "what happened").

**Why this choice:** Axiom has a first-class Vercel integration — enable it from the marketplace and all serverless function logs flow automatically with no code changes. No separate logging library is needed in production; structured `console.log()` output is sufficient when the log drain handles transport, storage, and indexing. The free tier is absurdly generous for a community app. Axiom also supports OpenTelemetry traces alongside logs, providing a path to distributed tracing if needed later. This is what most Next.js-on-Vercel teams use.

The observability stack is: **Sentry** catches errors and performance issues (reactive — tells you when things break). **Axiom** stores all request logs, searchable and queryable (proactive — lets you ask questions about traffic, audit actions, debug non-error issues). **Vercel's live tail** for quick debugging during development (ephemeral — useful in the moment, not retained).

**Known downsides:** Vendor dependency on Axiom for log storage, though logs are also visible in Vercel's live tail for immediate debugging. The Vercel Log Drain integration means logs only flow from Vercel-hosted functions — local development logs stay local (use Vercel's live tail or structured console output during `vercel dev`). If Axiom's free tier ever becomes insufficient, Grafana Cloud (Loki-based, open protocols) is the migration path with no vendor lock-in.
