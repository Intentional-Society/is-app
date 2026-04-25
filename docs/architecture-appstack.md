# Intentional Society Application — Application Stack

**Context:** A web application for Intentional Society — a small but globally distributed membership network with long-term maintenance horizons. The stack prioritizes low operational complexity, independent replaceability of components, and a clean API contract that can serve both web and future mobile clients.

---

## Production Stack (Front to Back)

### Next.js — Application Framework

**What it does:** Serves the authenticated community application. Provides the React rendering layer, file-based routing for pages, Server Components for initial page loads, and the hosting shell for the Hono API via a catch-all route.

**Connects to:** Users' browsers (delivers the React application), Vercel (deployment platform), and Hono (delegates all `/api/*` requests via adapter).

**Why this choice:** Next.js is the dominant React meta-framework (~35% of all new React projects, 67% enterprise adoption). It provides Server Components for faster initial loads of authenticated pages, file-based routing, image optimization, and the deepest integration with Vercel's deployment platform. The App Router and React Server Components represent React's official direction. For a project that may eventually need selective SSR (e.g., public member profiles for SEO), Next.js provides an incremental adoption path.

**Known downsides:** Architectural complexity. The Server Component / Client Component mental model requires understanding even when not actively used. Caching behavior has been revised multiple times and remains a source of confusion. Tight coupling to Vercel for optimal deployment — while Next.js deploys elsewhere, advanced features (Edge Middleware, ISR, image optimization) work best on Vercel. The framework blurs the frontend/backend boundary, which is why we mount Hono as a separate API layer rather than using Next.js API routes directly. Build output requires a Node.js runtime (not pure static files) unless explicitly exported as static.

---

### React — UI Library

**What it does:** Component-based UI rendering for the community application. All interactive views — member directory, group management, profile editing, event pages — are React components.

**Connects to:** Next.js (rendering framework and App Router for page navigation), TanStack Query (server state management), Hono API (data source via fetch calls).

**Why this choice:** React controls ~60% of new project starts in 2026, has the largest ecosystem, the deepest hiring pool, and the best AI coding tool support. It is the safest five-year bet for a UI library. TypeScript support is first-class. Every component library, design system, and community resource defaults to React.

**Known downsides:** Bundle size is larger than alternatives like Svelte or Solid. The ecosystem's rapid evolution (Server Components, Suspense, use() hook) means keeping up with best practices requires ongoing attention. React's virtual DOM adds overhead compared to compile-time frameworks, though this is not meaningful at community-app scale.

---

### TanStack Query — Server State Management

**What it does:** Manages all data fetched from the API — caching, background refetching, optimistic updates, retry logic, and cache invalidation. Provides `stale-while-revalidate` behavior so users see cached data instantly while fresh data loads in the background.

**Connects to:** React components (provides hooks for data access), Next.js App Router (data loads on navigation via query hooks in page components), Hono API (the data source).

**Why this choice:** This is the highest-leverage library for perceived performance with a globally distributed user base. A member in Lagos and a member in Seattle both see cached data instantly on navigation; fresh data arrives in the background. Eliminates the need for hand-rolled caching, loading states, and error handling across every component. It has become the de facto standard for React server-state management.

**Known downsides:** Adds conceptual overhead around cache keys, stale times, and invalidation strategies. For very simple CRUD apps, it may be over-engineered — but community apps with member directories, group listings, and event pages benefit from the caching model almost immediately.

---

### Tailwind CSS — Styling

**What it does:** Utility-first CSS framework. Styles are applied via class names directly in component markup rather than separate CSS files.

**Connects to:** React components (classes applied in JSX), Vite/Next.js build pipeline (purges unused classes in production).

**Why this choice:** Tailwind dominates the React ecosystem in 2026 — most component libraries (shadcn/ui, Radix, Headless UI) target it. It produces small production bundles (only used classes are included), eliminates naming conventions and CSS module configuration, and co-locates styling with markup for easier maintenance. The design-token system (colors, spacing, typography) enforces visual consistency.

**Known downsides:** Verbose class strings in JSX. Developers unfamiliar with Tailwind need to learn utility class names. Not suitable for highly custom CSS animations without escape hatches. Opinionated — developers with strong CSS preferences may resist it.

---

### Hono — API Framework (mounted inside Next.js)

**What it does:** Handles all backend API logic for the application. Receives requests delegated from Next.js via a catch-all route adapter at `app/api/[[...route]]/route.ts`. Provides middleware composition (auth, CORS, validation, error handling), routing, and the RPC client for type-safe API calls from the frontend.

**Connects to:** Next.js (receives requests via catch-all adapter), Drizzle ORM (queries database), Supabase Auth (verifies JWTs), Buttondown API (newsletter emails), React frontend (via fetch or Hono RPC client).

**Why this choice:** Hono provides a clean, portable API layer that is not welded to Next.js. All API logic — auth middleware, validation, business logic, error handling — is defined once and applies to every request regardless of origin (browser, Server Component, future mobile client). The Hono RPC client gives end-to-end type safety from API definition to frontend consumption without code generation. If the API ever needs to be extracted to a standalone service (for mobile, for scaling, for platform migration), the Hono code moves out with minimal changes.

The catch-all adapter pattern means the Next.js → Hono delegation is a function call within the same process, not a network hop. Latency overhead is sub-millisecond.

Hono deploys to Vercel with zero configuration and runs on Node.js serverless functions (not edge, since Drizzle/Postgres requires Node.js APIs).

**Known downsides:** Two routing systems in the same project (Next.js file-based for pages, Hono programmatic for API). Smaller ecosystem than Express or Fastify (~277K weekly npm downloads vs. 48M for Express). Some reported issues with Hono on Vercel in monorepo configurations. The Node.js runtime requirement (not edge) means slightly slower cold starts than edge functions, though Vercel's Fluid Compute mitigates this.

---

### Drizzle ORM — Database Access

**What it does:** Type-safe SQL query builder and schema definition for PostgreSQL. Schemas are defined in TypeScript files; types are inferred directly without a generation step. Generates SQL migration files via `drizzle-kit`.

**Connects to:** Hono handlers (called from API route logic), Supabase Postgres (the database), Drizzle Kit CLI (migration generation and application).

**Why this choice:** Drizzle is the lightest-weight, most transparent ORM in the TypeScript ecosystem. Schemas are plain TypeScript (no separate schema language, no `prisma generate` step), queries map directly to SQL (you see what runs), and the bundle is ~7KB (vs. ~800KB+ for Prisma's engine). It works natively on serverless without binary dependencies. The migration system generates reviewable SQL files. For a developer who knows SQL, Drizzle feels like SQL with type safety, not an abstraction that hides it.

**Known downsides:** No built-in migration rollback support — forward-only by design. You must follow the expand-contract pattern for zero-downtime schema changes (add new column → migrate code → remove old column across multiple deploys). Smaller ecosystem than Prisma. The relational query API is less mature than Prisma's for deeply nested includes. Drizzle is still pre-1.0 (release candidate as of early 2026), though it is widely used in production.

---

### Supabase — Auth + Managed PostgreSQL

**What it does:** Provides two services: (1) authentication (email/password, OAuth, magic links) with JWT issuance and self-managed auth email delivery (magic links, verification, password reset emails are sent by Supabase directly), and (2) a managed PostgreSQL database. The auth JWTs are verified in the Hono middleware layer. The Postgres instance is accessed via Drizzle ORM, not Supabase's auto-generated REST API.

**Connects to:** Hono middleware (JWT verification), Drizzle ORM (database queries), React frontend (Supabase client library for auth flows — login, signup, password reset).

**Why this choice:** Supabase provides auth and database as a unified service with a generous free tier. The auth system handles email verification, password resets, OAuth providers, and JWT issuance out of the box — eliminating an entire category of security-sensitive code. The database is standard Postgres (not a proprietary engine), and Supabase is open source and self-hostable — the strongest escape hatch of any BaaS. The dashboard includes database query logs, API logs, auth logs, and a SQL editor, providing built-in observability for the data layer.

Database access is locked to a single path — the Hono API. Two complementary measures keep the browser-exposed publishable key away from data: Supabase's auto-generated Data API (PostgREST + GraphQL) is disabled at the project level, and RLS is enabled on every `public` table with no policies, denying `anon` and `authenticated` at the row layer. RLS acts as a deny gate, not as the access-logic layer — authorization logic lives in the Hono middleware, avoiding the RLS complexity cliff for non-trivial access patterns. See `docs/doc-supabase.md` ("Data API — kept off").

**Known downsides:** Vendor dependency for auth and database hosting. While self-hostable, migrating off Supabase's managed service requires operational investment. The free tier pauses databases after 1 week of inactivity (relevant for low-traffic staging environments). Read replicas for global distribution are a paid feature. Connection pooling configuration requires attention in serverless environments.

---

### Email — Supabase Auth Emails + Buttondown (Newsletter) + Postmark (Future)

**What it does:** Email is handled by three providers depending on the use case. Supabase Auth sends its own transactional emails for authentication flows (magic links, password resets, email verification) — no additional email provider is needed for MVP auth. Buttondown, the existing newsletter provider, is available via API for bulk member communications. Postmark is the planned provider for application-triggered transactional emails (group notifications, event reminders, welcome messages) when those features are built beyond MVP.

**Connects to:** Supabase (auth emails sent automatically), Buttondown API (called from Hono handlers for newsletter/announcement use cases), Postmark (future — called from Hono handlers for transactional email), DNS (SPF, DKIM, DMARC records on the sending domain for Postmark when added).

**Why this approach:** For MVP, Supabase handles the only emails the application actually needs to send (auth flows), and Buttondown covers member communications. This avoids adding and configuring a transactional email provider before there are transactional emails to send. When the application grows features that trigger emails (someone joins your group, an event reminder, a new member welcome sequence), Postmark is the recommended addition — it has the best deliverability reputation among independent providers, with separate IP pools for transactional vs. marketing email. The key DNS setup (SPF, DKIM, DMARC on the sending domain) should be done once, early, regardless of which provider sends the email.

**Known downsides:** Supabase's built-in auth emails have limited customization (templates can be edited but the sending infrastructure is Supabase's). Buttondown is designed for newsletters, not triggered transactional emails — using it for application notifications would be misusing the tool. When Postmark is added, its free tier is small (100 emails/month) and a paid plan may be needed quickly depending on notification volume.

---

### Vercel — Deployment Platform

**What it does:** Hosts the Next.js application (including the Hono API via serverless functions). Provides CI/CD (push to Git → automatic build and deploy), deploy previews per pull request, SSL, global CDN for static assets, and serverless function execution.

**Connects to:** GitHub (deployment trigger), Next.js + Hono (the application), Supabase (database connection from serverless functions).

**Why this choice:** Vercel is the platform Next.js is built for. Deploy previews, zero-config CI/CD, and serverless scaling work with no operational effort. For a small team that doesn't want to manage infrastructure, Vercel eliminates the most operational work of any hosting option. Fluid Compute reduces cold starts to ~115ms.

**Known downsides:** Vendor lock-in — the more Vercel-specific features you use (image optimization, Edge Middleware, analytics), the harder migration becomes. The free Hobby tier is restricted to non-commercial, single-developer use. Pro tier is $20/seat/month. Pricing has been revised multiple times (most recently September 2025, introducing credit-based billing), which makes cost prediction harder. Usage-based billing means traffic spikes directly impact cost (Denial of Wallet risk). Database schema migrations must run outside the deploy pipeline (CI step or local command) since Vercel's serverless model has no "server startup" phase.

---

## Architecture Decisions & Conventions

### API Versioning

The Hono API is the contract boundary for all clients. When the schema evolves, the expand-contract migration pattern ensures backward compatibility: add new fields/endpoints first, migrate clients, then remove old ones. For breaking changes, versioned endpoints (`/api/v1/`, `/api/v2/`) allow old mobile clients to continue functioning while the web app uses the latest version.

### Database Migrations

Drizzle Kit generates SQL migration files from TypeScript schema changes. Migrations run via a CI/CD pipeline step (GitHub Actions) or manually before deployment — not at serverless function startup. The expand-contract pattern is mandatory for any migration that changes or removes existing columns or tables to avoid breaking clients that haven't updated yet.

### Authentication Flow

Supabase Auth handles signup, login, magic links, password reset, and JWT issuance. Supabase sends its own emails for these flows (magic link delivery, email verification, password reset links) — no external email provider is needed for authentication. The Supabase client library in the React frontend manages the auth flow and stores the JWT. The JWT is sent with API requests and verified in Hono middleware before any route handler executes. This means auth is enforced in one place (the middleware) and every handler can trust that the user is authenticated.

### Font Loading

Self-hosted woff2 font files with `<link rel="preload">` and metric-matched system font fallbacks (size-adjust, ascent-override, descent-override). `font-display: swap` ensures text is visible immediately. The layout does not shift when the custom font loads — only letterform aesthetics change.

### Future Mobile Path

The architecture supports progressive mobile investment: (1) PWA first — add a manifest and service worker to the Next.js app for installable mobile experience at zero additional development cost. (2) Capacitor if app store presence is needed — wraps the existing web app in a native shell. (3) Expo/React Native if native performance is required — consumes the same Hono API endpoints. The separated API contract (Hono) ensures any mobile client can be built against the same backend without architectural changes.
