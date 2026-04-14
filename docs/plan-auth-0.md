# Plan: Auth & Members — Shared Decisions

The four-phase effort to add authentication and member accounts:

0. **Shared decisions & non-goals (this document)**
1. [Plumbing](./plan-auth-1-plumbing.md) — auth wiring, minimal profile, Hono middleware
2. [Profile schema expansion](./plan-auth-2-profile.md) — rich profile fields, sensitive-field access control
3. [Invites](./plan-auth-3-invites.md) — member-generated invite codes, signup flow
4. [Member migration](./plan-auth-4-migration.md) — seed ~40 existing members from Google Sheet

Each phase is self-contained, individually mergeable, and demoable on its own. This document collects the decisions and deliberate non-goals that apply across all four.

---

## Shared decisions (apply to all phases)

- **Auth method:** magic link by default. Members can optionally set a password after first sign-in (via the profile completion flow in Phase 2) and then use email + password to sign in. No password reset flow — magic link serves as password recovery. Signup is always magic link (eliminates the need for a separate email-confirmation step).
- **Signup model:** invite codes. Any member can generate codes. Single-use. 30-day expiry. Required free-text note on generation. Rate-limited to 10 active (unredeemed, unexpired, unrevoked) invites per member.
- **Existing members (~40):** migrated via Supabase Admin API (`inviteUserByEmail`), no invite code required. Data source is a Google Sheet exported as CSV.
- **Entry point:** `/` is the authed landing page. Unauthenticated visitors are redirected to `/login`.
- **Profile ↔ `auth.users` sync:** app-level in `/auth/callback` (idempotent upsert), not a DB trigger.
- **Programs:** curated, admin-managed list. Modeled as many-to-many (`programs` + `profilePrograms` tables). Defined in a committed `scripts/programs.seed.json`; no admin UI in this plan.
- **Access control:** Hono API middleware on all `/api/*` routes per [architecture-appstack.md](./architecture-appstack.md). RLS intentionally not the primary mechanism. Sensitive fields (notably `emergencyContact`, added in Phase 2) are filtered at the API serialization layer.
- **E2E auth testing:** Playwright session-minting helper using the Supabase Admin API. Bypasses magic-link email entirely. Real magic-link flow is exercised manually during development.

## Deliberate non-goals (across all auth phases)

- Profile edit UI (members cannot change their own data through the app yet — admin hand-edits via DB for now).
- Member directory page.
- Admin UI for managing programs (JSON file is the source of truth).
- Admin UI for mass invite revocation.
- OAuth providers.
- Password reset flow (magic link serves as password recovery).
- Email preferences, notifications, Buttondown integration.
- Supabase Storage for avatar uploads (`avatarUrl` is a string field).
- Real magic-link click-through in automated tests (covered by manual QA + the session-minting helper introduced in Phase 3).
- RLS policies (intentionally not the primary access mechanism per architecture doc).
