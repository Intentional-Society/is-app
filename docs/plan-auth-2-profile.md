# Plan: Auth Profile Schema Expansion (Phase 2)

Part of a four-phase effort to add authentication and member accounts:

0. [Shared decisions & non-goals](./plan-auth-0.md)
1. [Plumbing](./plan-auth-1-plumbing.md) — auth wiring, minimal profile, Hono middleware
2. **Profile schema expansion (this document)** — rich profile fields, sensitive-field access control
3. [Invites](./plan-auth-3-invites.md) — member-generated invite codes, signup flow
4. [Member migration](./plan-auth-4-migration.md) — seed ~40 existing members from Google Sheet

Shared decisions (auth method, access control approach, etc.) and deliberate non-goals are documented in [plan-auth-0.md](./plan-auth-0.md).

**Prerequisites:** Phase 1 merged.

---

## Context

Phase 1 created `profiles` with only `id`, `displayName`, and `createdAt` — enough to demo auth end-to-end, not enough to represent a community member. The existing membership is already tracked with a richer shape (pulled from a Google Form): bio, keywords, location, emergency contact, and free-text "live desire," among others. This phase expands the `profiles` table to match, and introduces the serialization-layer access control pattern for sensitive fields.

The underlying table is altered in place (expand step of expand-contract). Columns are added as nullable (or with safe defaults) so existing rows — there will be at most one: yourself, signed in to test Phase 1 — continue to work without backfill.

## Schema changes (`src/server/schema.ts`)

Alter `profiles` to add the following columns. All nullable unless marked otherwise.

- `bio` — `text`, nullable
- `keywords` — `text[]`, not null, default `{}` (Postgres array; GIN-indexable if search is needed later)
- `location` — `text`, nullable (approximate free text, not an address — community convention)
- `supplementaryInfo` — `text`, nullable
- `referredBy` — `uuid`, nullable, self-FK to `profiles.id` (canonical, populated by invite redemption in Phase 3)
- `referredByLegacy` — `text`, nullable (free-text "who referred you?" from the existing Google Form; populated for migrated members only, preserves history that is otherwise unrecoverable)
- `avatarUrl` — `text`, nullable (URL only; image upload UI is out of scope)
- `emergencyContact` — `text`, nullable (**sensitive PII — see access control note below**)
- `liveDesire` — `text`, nullable
- `isAdmin` — `boolean`, not null, default `false`

Generate and apply: `npx drizzle-kit generate` → review the SQL (should be `ALTER TABLE` statements, not `CREATE TABLE`) → commit → `npx drizzle-kit migrate`.

No new tables in this phase — `programs` and `profilePrograms` already exist from Phase 1.

## Sensitive field access control

`emergencyContact` is PII (typically a name and phone number). Since RLS is not the primary mechanism, the Hono API enforces visibility at the serialization layer. Three shapes, all defined in `src/server/profiles.ts`:

- **`getProfileForSelf(userId)`** — includes `emergencyContact`. Used by `/api/me`.
- **`getProfileForMember(userId)`** — omits `emergencyContact`. Placeholder for a future member-directory endpoint. Not built in this phase.
- **`getProfileForAdmin(userId)`** — includes `emergencyContact`. Placeholder for future admin tooling. Not built in this phase.

Phase 2 implements only `getProfileForSelf`. The other two shapes are declared with stubs so the access pattern is decided the moment member-directory work starts. The Phase 1 `upsertProfile(user)` helper stays — it still only writes `id` + `displayName`, since no other fields are known at signup time.

## `/api/me` update

Phase 1's `/api/me` returned `{ id, email, profile: { id, displayName, createdAt } }`. Phase 2 swaps the inline shape for `getProfileForSelf(user.id)`, which returns the full profile including `emergencyContact` and a joined list of the member's programs via `profilePrograms` → `programs`.

## `PUT /api/me` endpoint (new)

Authed. Accepts the editable subset of profile fields (`bio`, `keywords`, `location`, `supplementaryInfo`, `avatarUrl`, `emergencyContact`, `liveDesire`). Validates input (e.g. `keywords` is an array of strings) and updates the caller's own profile row. Returns the updated profile via `getProfileForSelf`.

Fields not accepted: `id`, `displayName` (set at signup), `referredBy`, `referredByLegacy`, `isAdmin`, `createdAt`.

## Profile completion flow (`src/app/welcome/page.tsx` — new)

After first sign-in, members land on `/` which detects an incomplete profile (e.g. `bio` is null) and redirects to `/welcome`. This page presents a form to fill in bio, keywords, location, etc. — the same fields accepted by `PUT /api/me`. Submitting saves the profile and redirects to `/`.

The form also includes an **optional password section**: "Set a password for faster sign-in (you can always use magic link instead)." This calls `supabase.auth.updateUser({ password })` client-side — GoTrue handles hashing and storage directly. No new API endpoint needed for password setting.

Members who skip the password section can set one later by signing in via magic link and revisiting `/welcome` (or a future account-settings page).

## Login page update (`src/app/login/page.tsx`)

Phase 1's login page has a single email field and sends a magic link. Phase 2 extends it to dual-mode:

- Email field (always visible).
- Password field (always visible, but optional). Placeholder text: "Leave blank to use magic link".
- Single submit button.
- If password is provided → `supabase.auth.signInWithPassword({ email, password })`. On success → redirect to `/`. On failure (wrong password) → show error, do not fall back to magic link.
- If password is blank → `supabase.auth.signInWithOtp(...)` → "check your email" state.

No "forgot password?" link. If a member forgets their password, they leave the field blank and sign in via magic link — then set a new password from `/welcome`.

## Tests

- **Functional (Vitest):**
  - `getProfileForSelf` includes `emergencyContact` (shape guard against accidental omission in future refactors).
  - `getProfileForMember` does **not** include `emergencyContact` (shape guard for the inverse).
  - `PUT /api/me` updates only allowed fields; rejects `isAdmin`, `referredBy`.
  - Existing `upsertProfile` tests still pass — the helper is unchanged.
- **E2E (Playwright):**
  - Member with incomplete profile redirected to `/welcome` after sign-in.
  - Filling out the form and submitting → profile updated, redirected to `/`.
  - Password field on `/login`: submitting with password → `signInWithPassword` called; submitting without → `signInWithOtp` called.

## Files touched / created

- `src/server/schema.ts` — alter `profiles` (additive column list)
- `drizzle/migrations/*` — new SQL (expected to be `ALTER TABLE`)
- `src/server/profiles.ts` — add `getProfileForSelf` + stubs for `getProfileForMember` / `getProfileForAdmin`
- `src/server/api.ts` — `/api/me` swaps to `getProfileForSelf`; new `PUT /api/me`
- `src/app/welcome/page.tsx` — new: profile completion + optional password
- `src/app/login/page.tsx` — extended with optional password field
- `tests/functional/profiles.test.ts` — extend with access control shape guards + `PUT /api/me` tests
- `tests/e2e/profile-completion.spec.ts` — new

## Verification

1. `npx drizzle-kit generate` → confirm generated SQL is `ALTER TABLE`, not `CREATE TABLE profiles`.
2. Apply migration.
3. Sign in (using the flow from Phase 1).
4. Redirected to `/welcome` (profile is incomplete).
5. Fill out the form, set a password, submit → lands on `/`.
6. `/api/me` now returns the full profile shape with the values just entered.
7. Sign out. Sign back in with email + password → lands on `/` directly (no `/welcome` redirect — profile is complete).
8. Sign out. Sign in with email only (blank password) → magic link → click → `/`.
9. `npm test` green.
