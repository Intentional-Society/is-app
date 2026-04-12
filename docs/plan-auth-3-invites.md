# Plan: Auth Invites (Phase 3)

Part of a four-phase effort to add authentication and member accounts:

0. [Shared decisions & non-goals](./plan-auth-0.md)
1. [Plumbing](./plan-auth-1-plumbing.md) — auth wiring, minimal profile, Hono middleware
2. [Profile schema expansion](./plan-auth-2-profile.md) — rich profile fields, sensitive-field access control
3. **Invites (this document)** — member-generated invite codes, signup flow
4. [Member migration](./plan-auth-4-migration.md) — seed ~40 existing members from Google Sheet

Shared decisions (auth method, access control approach, etc.) and deliberate non-goals are documented in [plan-auth-0.md](./plan-auth-0.md).

**Prerequisites:** Phases 1 and 2 merged. Phase 2's `profiles.isAdmin` and `profiles.referredBy` columns are required.

---

## Context

Phase 2 ends with a complete profile schema, but the only way to create a user is still manual Studio work. This phase adds the invite-code flow so any signed-in member can bring in new members, and the full profile (`displayName`, `referredBy`) is captured atomically on first sign-in.

Signup is always via magic link — this eliminates the need for a separate email-confirmation step. New members can optionally set a password afterward via the Phase 2 profile completion flow at `/welcome`.

The `invites` table itself already exists from Phase 1 — only the endpoints, UI, and redemption logic are new here.

## Hono endpoints (`src/server/api.ts`)

- **`POST /api/invites`** — authed. Body: `{ note: string }` (min 10 chars). Enforces the 10-active-invite cap for `createdBy`. Generates code, inserts row, `expiresAt = now() + interval '30 days'`. Returns `{ code, expiresAt, note }`.
- **`GET /api/invites/mine`** — authed. Returns all invites created by the current user (active, redeemed, expired, revoked) so members can see their history.
- **`POST /api/invites/:code/revoke`** — authed. Allowed if `createdBy === currentUser || currentUser.isAdmin`. Sets `revokedAt`.
- **`GET /api/invites/:code/check`** — **public** (added to the allowlist). Returns `{ valid: boolean, note?: string }` without consuming the code. Used by `/signup` to give feedback before asking for email.

## Redemption flow — atomic, inside `/auth/callback`

The invite code has to survive the magic-link round-trip. Flow:

1. `/signup`: user enters code → `GET /api/invites/:code/check` validates → user sees the note (context of who/why) → enters email + display name → client calls:
   ```ts
   supabase.auth.signInWithOtp({
     email,
     options: {
       emailRedirectTo: `${origin}/auth/callback?invite=${code}`,
       data: { displayName },
     },
   });
   ```
2. User clicks the magic link → lands on `/auth/callback?code=<pkce>&invite=<code>`.
3. Callback exchanges PKCE → gets user → inside `db.transaction`:
   - Atomic redemption:
     ```sql
     UPDATE invites
     SET redeemed_by = $userId, redeemed_at = now()
     WHERE code = $code
       AND redeemed_by IS NULL
       AND revoked_at IS NULL
       AND expires_at > now()
     RETURNING created_by;
     ```
   - `rowcount = 0` → code was consumed/revoked/expired between check and click. Sign the user out, redirect to `/login?error=invite_invalid`.
   - `rowcount = 1` → insert profile with `displayName` from `user_metadata`, `referredBy` from the returned `created_by`.
   - Both writes in one transaction: either both land or neither does.
4. No `invite` query param → the existing Phase 1 upsert runs, `referredBy` stays null.

## Signup page (`src/app/signup/page.tsx` — new)

Two-step client form:
1. Enter code → check → display the inviter's note → continue.
2. Enter email + display name → send magic link → "check your email".

## `/` additions (authed view)

- **Invite a member** panel: button opens a modal that asks for a note (min 10 chars), submits via `POST /api/invites`, displays the generated code with a copy button.
- **My invites** table: lists current user's invites with status (active / expired / redeemed / revoked) and a revoke button on active rows.

## Playwright session-minting helper

`tests/e2e/helpers/session.ts` — new. Uses `@supabase/supabase-js` with the local service-role key to:
1. Create a test user via `supabase.auth.admin.createUser({ email, email_confirm: true })`.
2. Generate a session directly (or use `generateLink({ type: 'magiclink' })` and consume it server-side).
3. Set the session cookie on the Playwright browser context so the test starts authenticated.

Teardown deletes the test user. This helper unblocks all subsequent e2e tests that need an authed starting state.

## Tests

- **Functional (Vitest):**
  - Invite generation: 10-active cap is enforced (11th request → 429).
  - Invite check: correct `valid` result for each state (active / expired / revoked / redeemed / nonexistent).
  - Atomic redemption under contention: two concurrent transactions redeeming the same code → exactly one succeeds. Use `Promise.all` over two tx wrappers, assert exactly one returns a row.
  - Revoke permission: non-admin, non-creator request → 403.
- **E2E (Playwright):**
  - Using the session-minting helper: authed member lands on `/`, generates an invite, sees it in "My invites".
  - Unauthed visitor enters code on `/signup`, sees note, submits email → stubbed `signInWithOtp` succeeds → UI shows "check your email".
  - Full magic-link click-through is still not e2e-tested; covered by developer sign-in during manual QA.

## Verification

1. Signed in as a member: create an invite with a note. Copy the code.
2. Sign out. Visit `/signup`. Enter the code — note is displayed.
3. Enter email + display name → "check your email".
4. Grab the magic link from Inbucket → click → lands on `/` as the new user.
5. The new user's profile has `displayName` set and `referredBy` pointing at the inviter.
6. Try to reuse the same code from another browser → "invite invalid".
7. Create 10 invites in quick succession → 11th fails with a rate limit error.
8. Revoke an active invite → it disappears from the active filter and can't be redeemed.
9. `npm test` green.
