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

Phase 1 deferred the `programs` / `profilePrograms` tables to "a dedicated micro-PR when a later phase actually needs them." Phase 2 is that moment — the tables land here as structure only (no seed data, no endpoints, not joined into any profile shape). Programs are a membership classification, not a profile field, so they are intentionally kept out of `getProfileFor*`.

## Commit plan

This phase lands as a single PR built from five sequential commits. Each commit keeps the app in a working state.

| Commit | Scope | Key changes |
|--------|-------|-------------|
| **2a** | Schema expand + migration | `schema.ts` (alter profiles, add programs + profilePrograms), generated SQL |
| **2b** | Serialization layer + `/api/me` swap | `profiles.ts` (`getProfileForSelf` + stubs), `api.ts` swap, shape-guard tests |
| **2c** | `PUT /api/me` | `api.ts` endpoint, zod validation, functional tests |
| **2d** | `/welcome` page + incomplete-profile redirect | `welcome/page.tsx`, `page.tsx` redirect, e2e |
| **2e** | Login dual-mode (email + optional password) | `login-form.tsx`, e2e |

## Schema changes (`src/server/schema.ts`)

### Alter `profiles` — add the following columns. All nullable unless marked otherwise.

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

### New tables (structure only, no seed)

- `programs` — `id` (uuid PK, default `gen_random_uuid()`), `slug` (text, unique, not null), `name` (text, not null), `description` (text, nullable), `createdAt` (timestamptz, not null, default `now()`).
- `profilePrograms` — `profileId` (uuid, FK to `profiles.id` on delete cascade), `programId` (uuid, FK to `programs.id` on delete cascade), composite PK `(profileId, programId)`, `assignedAt` (timestamptz, not null, default `now()`).

No seed data, no seed script, no endpoints in this phase. A later phase will introduce admin-managed seeding and membership assignment.

Generate and apply: `npx drizzle-kit generate` → review the SQL (expect `ALTER TABLE` for `profiles` and `CREATE TABLE` for the two new tables) → commit → `npx drizzle-kit migrate`.

## Sensitive field access control

`emergencyContact` is PII (typically a name and phone number). Since RLS is not the primary mechanism, the Hono API enforces visibility at the serialization layer. Three shapes, all defined in `src/server/profiles.ts`:

- **`getProfileForSelf(userId)`** — includes `emergencyContact` and `isAdmin`. Used by `/api/me`.
- **`getProfileForMember(userId)`** — stub that throws `NotImplemented`. Placeholder so the access decision is forced when member-directory work starts. Not built in this phase.
- **`getProfileForAdmin(userId)`** — stub that throws `NotImplemented`. Placeholder for future admin tooling. Not built in this phase.

None of the shapes include programs — program membership is a separate concern and will get its own endpoint in a later phase. The Phase 1 `upsertProfile(user)` helper stays unchanged — it still only writes `id` + `displayName`, since no other fields are known at signup time.

## `/api/me` update

Phase 1's `/api/me` returned `{ id, email, profile: { id, displayName, createdAt } }`. Phase 2 swaps the inline shape for `getProfileForSelf(user.id)`, which returns the full profile (all columns including `emergencyContact` and `isAdmin`). Programs are **not** included.

## `PUT /api/me` endpoint (new)

Authed. Accepts the editable subset of profile fields (`bio`, `keywords`, `location`, `supplementaryInfo`, `avatarUrl`, `emergencyContact`, `liveDesire`). Validates input (e.g. `keywords` is an array of strings) and updates the caller's own profile row. Returns the updated profile via `getProfileForSelf`.

Fields not accepted: `id`, `displayName` (set at signup), `referredBy`, `referredByLegacy`, `isAdmin`, `createdAt`.

## Profile completion flow (`src/app/welcome/page.tsx` — new)

After first sign-in, members land on `/`. The "incomplete profile" heuristic is `bio IS NULL` — bio is the one field every member must supply, and a new Phase 1 member will have it as null. If incomplete, `/` redirects to `/welcome`. This page presents a form to fill in bio, keywords, location, etc. — the same fields accepted by `PUT /api/me`. Submitting saves the profile and redirects to `/`.

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
  - `getProfileForSelf` includes `emergencyContact` and `isAdmin` (shape guard against accidental omission in future refactors).
  - `getProfileForMember` / `getProfileForAdmin` throw `NotImplemented` (lock in the "decide-on-use" contract).
  - `PUT /api/me` updates only allowed fields; rejects `isAdmin`, `referredBy`, `displayName`, and unknown keys.
  - `PUT /api/me` rejects malformed input (e.g. `keywords` not an array of strings) with a 400.
  - Existing `upsertProfile` tests still pass — the helper is unchanged.
- **E2E (Playwright):**
  - Password field on `/login`: submitting with password → `signInWithPassword` called; submitting without → `signInWithOtp` called. Uses route interception on the Supabase auth endpoints; `/login` is public so no session needed.
  - Signed-in e2e coverage for the `/welcome` redirect and form submission is **deferred to Phase 3**, which owns the Playwright session-minting helper. Phase 2 verifies this flow manually (see Verification steps 3–6 below).

## Files touched / created

- `src/server/schema.ts` — alter `profiles` (additive column list); add `programs` + `profilePrograms` tables
- `drizzle/*.sql` — new generated migration (mixed `ALTER TABLE profiles` + `CREATE TABLE` for the two new tables)
- `src/server/profiles.ts` — add `getProfileForSelf` + `NotImplemented` stubs for `getProfileForMember` / `getProfileForAdmin`
- `src/server/api.ts` — `/api/me` swaps to `getProfileForSelf`; new `PUT /api/me`
- `src/app/page.tsx` — redirect to `/welcome` when `profile.bio === null`
- `src/app/welcome/page.tsx` + `welcome-form.tsx` — new: profile completion + optional password
- `src/app/login/login-form.tsx` — extended with optional password field
- `tests/functional/profiles.test.ts` — extend with access control shape guards
- `tests/functional/api-me.test.ts` — extend (new shape) + add `PUT /api/me` tests
- `tests/e2e/profile-completion.spec.ts` — new (welcome redirect + form submit)
- `tests/e2e/login-password.spec.ts` — new (dual-mode login via route interception)

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
