# Plan: Auth Plumbing (Phase 1)

Part of a four-phase effort to add authentication and member accounts:

0. [Shared decisions & non-goals](./plan-auth-0.md)
1. **Plumbing (this document)** — auth wiring, minimal profile, Hono middleware
2. [Profile schema expansion](./plan-auth-2-profile.md) — rich profile fields, sensitive-field access control
3. [Invites](./plan-auth-3-invites.md) — member-generated invite codes, signup flow
4. [Member migration](./plan-auth-4-migration.md) — seed ~40 existing members from Google Sheet

This phase gets us from zero auth to a signed-in user viewing a minimal profile at `/`. It is deliberately small: just the auth wiring. The full profile schema, invite flow, and migration of existing members are later phases. Mergeable and demoable on its own.

Shared decisions (auth method, access control approach, etc.) and deliberate non-goals are documented in [plan-auth-0.md](./plan-auth-0.md).

---

## Context

The IS app has Supabase auth helpers scaffolded at `src/lib/supabase/{client,server,middleware}.ts` but nothing is wired up end-to-end. The Drizzle schema (`src/server/schema.ts`) is empty, the Hono API (`src/server/api.ts`) has no auth middleware so every endpoint is public, there is no root `src/middleware.ts` to refresh sessions, and there are no auth routes. The current `/` (`src/app/page.tsx`) is a public demo page hitting `/api/hello` and `/api/health`.

Phase 1 does the minimum needed to prove auth works end-to-end: a user can sign in via magic link, land on `/`, and see their own minimal profile (just `displayName`). The full community profile shape — `bio`, `keywords`, `location`, `emergencyContact`, etc. — is intentionally deferred to Phase 2 so the plumbing PR stays focused on auth wiring.

## Schema (`src/server/schema.ts`)

Four tables, Drizzle `pg-core`. The `profiles` table ships minimal; Phase 2 alters it to add the rich fields. The other three tables are defined here to avoid splintering the initial migration — cheaper than three separate migration rounds as Phases 2 and 3 layer in.

### `profiles` (minimal)
- `id` — `uuid`, PK, references `auth.users(id)` with `onDelete: "cascade"`
- `displayName` — `text`, not null
- `createdAt` — `timestamptz`, not null, default `now()`

### `invites` (schema lands in Phase 1; endpoints in Phase 3)
- `id` — `uuid`, PK, default `gen_random_uuid()`
- `code` — `text`, unique, not null (12 chars base32, human-readable: `K3JA-9P2F-XQ7M`)
- `createdBy` — `uuid`, not null, FK to `profiles.id`
- `note` — `text`, not null (min 10 chars enforced at API layer in Phase 3)
- `createdAt` — `timestamptz`, not null, default `now()`
- `expiresAt` — `timestamptz`, not null
- `redeemedBy` — `uuid`, nullable, FK to `profiles.id`
- `redeemedAt` — `timestamptz`, nullable
- `revokedAt` — `timestamptz`, nullable

### `programs`
- `id` — `uuid`, PK, default `gen_random_uuid()`
- `slug` — `text`, unique, not null (URL-safe identifier, e.g. `monthly-circle`)
- `name` — `text`, not null
- `description` — `text`, nullable
- `createdAt` — `timestamptz`, not null, default `now()`

### `profilePrograms` (junction)
- `profileId` — `uuid`, not null, FK to `profiles.id`, `onDelete: "cascade"`
- `programId` — `uuid`, not null, FK to `programs.id`, `onDelete: "cascade"`
- `joinedAt` — `timestamptz`, not null, default `now()`
- Composite PK `(profileId, programId)`

Generate and apply: `npx drizzle-kit generate` → review SQL → commit → `npx drizzle-kit migrate`.

**Note on `profiles.id → auth.users(id)` FK:** Drizzle does not own the `auth.users` table, but the FK can still be declared; generated SQL references `auth.users` directly. Works in both local Supabase and prod.

## Session refresh (`src/middleware.ts` — new, project root)

Thin wrapper that delegates to the existing `src/lib/supabase/middleware.ts` helper. Standard Supabase App Router pattern: refreshes tokens on each request, propagates updated cookies onto the response. Standard `matcher` config excludes `_next/*`, static assets, favicons, and `/api/health`.

## Auth callback (`src/app/auth/callback/route.ts` — new)

GET handler:

1. Read `code` from query string (PKCE).
2. Call `supabase.auth.exchangeCodeForSession(code)` via the server client.
3. On success, read the user and idempotently upsert a `profiles` row:
   - If the row exists → no-op.
   - If missing → insert with `displayName = user.user_metadata.displayName ?? <email local-part>`.
   - Uses `ON CONFLICT (id) DO NOTHING`.
4. Redirect to `/` (or a `next` query param if present and same-origin).
5. On failure, redirect to `/login?error=<code>`.

The idempotent upsert self-heals the edge case where the callback crashes between auth success and profile insert — the next sign-in just creates the profile.

Phase 3 extends this route to also consume an `invite` query param inside the same transaction.

## Login page (`src/app/login/page.tsx` — new)

Server component shell + client component form. One input (email), submit button. On submit:

```ts
supabase.auth.signInWithOtp({
  email,
  options: { emailRedirectTo: `${origin}/auth/callback` },
});
```

Shows a "check your email" state on success. Phase 1 is magic-link-only. Phase 2 extends this page to also accept an optional password (for members who have set one).

## Hono auth middleware (`src/server/api.ts`)

Add middleware that runs on all `/api/*` routes except an explicit public allowlist:

- Extract the Supabase session from request cookies using the server client (same cookie-reading pattern as `src/lib/supabase/server.ts`; Hono reads cookies from `c.req.raw.headers`).
- No session → `401 { error: "unauthenticated" }`.
- Session present → `c.set('user', user)`, call `next()`.
- Public allowlist: `/api/health`.
- `/api/hello` becomes protected (demo-only, fine to gate).

Introduce `type Variables = { user: SupabaseUser }` and thread through `new Hono<{ Variables: Variables }>()`.

## `/api/me` endpoint

Returns `{ id, email, profile: { id, displayName, createdAt } }`. The `profile` shape is deliberately minimal — Phase 2 expands it to include all community fields along with the sensitive-field access control pattern.

## Protected routing

- **`src/app/page.tsx`** — convert from the existing public client component to a server component that reads the session via the server client.
  - Unauthenticated → `redirect('/login')`.
  - Authenticated → render the authed landing page: user email + `displayName` from a direct Drizzle call, a small client component that calls `apiClient.api.me.$get()` to prove the round-trip works, and a sign-out form (server action calling `supabase.auth.signOut()` then `redirect('/login')`).

## apiClient credentials

`src/lib/api.ts` uses Hono RPC. Same-origin browser fetches include cookies by default. Verify during implementation; if the server doesn't see the session cookie, pass `{ credentials: 'include' }` when constructing the client.

## Tests

- **Functional (Vitest):**
  - Hono auth middleware: unauthenticated → 401; authenticated (mocked server client) → handler runs; `/api/health` reachable without session.
  - Profile upsert: double-call with same user id → one row, no duplicates, no errors.
- **E2E (Playwright):**
  - Unauthenticated visit to `/` → redirects to `/login`.
  - Unauthenticated `fetch('/api/hello')` → 401.
  - Full magic-link round-trip test is deferred to Phase 3, which introduces the session-minting helper as part of testing the invite flow.

## Files touched / created

- `src/server/schema.ts` — four tables (profiles minimal)
- `drizzle/migrations/*` — generated SQL
- `src/server/profiles.ts` — new: single `upsertProfile(user)` helper
- `src/middleware.ts` — new
- `src/app/auth/callback/route.ts` — new
- `src/app/login/page.tsx` — new
- `src/app/page.tsx` — converted to authed landing (server component with unauthed redirect)
- `src/server/api.ts` — auth middleware, `Variables` type, `/api/me`, protect `/api/hello`
- `tests/functional/auth-middleware.test.ts` — new
- `tests/functional/profiles.test.ts` — new
- `tests/e2e/auth-redirect.spec.ts` — new
- `docs/devjournal.md` — dated entry documenting the phase split and why not RLS

## Verification

1. `npm run dev` (local Supabase + Next.js).
2. `http://localhost:3000/` → redirects to `/login`.
3. In Supabase Studio (`http://localhost:54323`), add a user via the auth UI.
4. "Send magic link" from Studio → email appears in Inbucket (`http://localhost:54324`) → click → lands on `/`.
5. `/` shows the user's email and freshly-upserted profile (`displayName` = email local-part).
6. `curl http://localhost:3000/api/hello` (no cookie) → 401.
7. Same endpoint from the signed-in browser → 200.
8. `/api/me` returns `{ id, email, profile: { id, displayName, createdAt } }`.
9. Sign out → back to `/login`.
10. `npm test` (full suite) green.

## Key files to reference (existing)

- `src/lib/supabase/server.ts:4` — server client factory
- `src/lib/supabase/client.ts:3` — browser client
- `src/lib/supabase/middleware.ts:4` — session refresh helper (called by the new root `src/middleware.ts`)
- `src/server/api.ts:6` — Hono instance (auth middleware goes right after the existing logging middleware at line 8)
- `src/server/api.ts:19` — existing `/api/hello` (becomes protected)
- `src/server/api.ts:22` — existing `/api/health` (stays public via allowlist)
- `src/server/db.ts` — Drizzle connection, unchanged
- `src/lib/api.ts` — Hono RPC `apiClient`
- `docs/architecture-appstack.md` — "Supabase — Auth + Managed PostgreSQL" and "Authentication Flow" sections document the contract this plan implements
- `docs/doc-strategy-committing.md` — expand-contract pattern
