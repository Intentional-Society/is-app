# Plan: Auth Member Migration (Phase 4)

Part of a four-phase effort to add authentication and member accounts:

0. [Shared decisions & non-goals](./plan-auth-0.md)
1. [Plumbing](./plan-auth-1-plumbing.md) — auth wiring, minimal profile, Hono middleware
2. [Profile schema expansion](./plan-auth-2-profile.md) — rich profile fields, sensitive-field access control
3. [Invites](./plan-auth-3-invites.md) — member-generated invite codes, signup flow
4. **Member migration (this document)** — seed ~40 existing members from Google Sheet

Shared decisions (auth method, access control approach, etc.) and deliberate non-goals are documented in [plan-auth-0.md](./plan-auth-0.md).

**Prerequisites:** Phases 1, 2, and 3 merged. Phase 2's rich profile columns (`bio`, `keywords`, `emergencyContact`, `liveDesire`, etc.) are the target shape for the seed script.

---

## Context

Phase 3 ends with a working invite-driven signup flow for new members. This phase onboards the ~40 members who were previously tracked in a Google Form, using the Supabase Admin API to create their accounts directly (bypassing invite codes) and populating their profiles from the exported sheet.

## Program seed (`scripts/programs.seed.json` — new)

Committed JSON file, the source of truth for the curated program list:

```json
[
  { "slug": "monthly-circle", "name": "Monthly Circle", "description": "..." },
  { "slug": "book-club", "name": "Book Club", "description": "..." }
]
```

An idempotent seed function upserts these by `slug`. Run as the first step of the migration, before the member seed. Also safe to run on every deploy if programs are ever added by PR.

## Member seed script (`scripts/seed-members.ts` — new)

Reads `scripts/members.csv` (gitignored — real emails and PII). Expected column headers (final names documented in the runbook once the sheet is exported):

```
email, name, bio, keywords, location, supplementary_info,
referred_by, avatar_url, emergency_contact, live_desire, programs
```

- `keywords` — comma-separated string → `text[]`.
- `programs` — comma-separated slugs matching `programs.seed.json` → `profilePrograms` rows.
- `referred_by` — free text from the Google Form → `referredByLegacy`. `referredBy` (uuid FK) stays null for migrated members.

Flow per row:
1. Check if email already exists in `auth.users` (via `supabase.auth.admin.listUsers`). If yes, skip.
2. `supabase.auth.admin.inviteUserByEmail(email)` with `SUPABASE_SERVICE_ROLE_KEY`. This creates the `auth.users` row and sends an invitation email containing a magic link.
3. Insert `profiles` row with all fields from the CSV.
4. Insert `profilePrograms` rows for each matching program.

Flags:
- `--dry-run` — prints intent, no writes, no email sends.
- `--limit N` — only process the first N rows (staged rollout).
- `--skip-email` — creates `auth.users` + `profiles` rows without sending invitation emails (staging).

Output: `{ created, skipped, failed, errors }`.

## First-admin bootstrap

After the seed runs and you've confirmed sign-in works, one-off SQL:

```sql
UPDATE profiles SET is_admin = true
WHERE id = (SELECT id FROM auth.users WHERE email = 'you@example.com');
```

Documented in `docs/doc-seed-members.md`. Not automated — runs once per environment, and automating it would add config surface (`ADMIN_EMAILS` env var) that is easy to get wrong.

## Environment

New env var: **`SUPABASE_SERVICE_ROLE_KEY`**. Never exposed client-side. Only used by `scripts/*` and any admin-only server code. Added to:
- `.env.local.example`
- `npm run setup` (local Supabase prints the key in `supabase status`)
- `docs/doc-vercel.md` — note that production **does not** need this key; it is only used for one-time migrations from a developer machine
- `CLAUDE.md` Commands section — `npm run seed:programs`, `npm run seed:members`

## Docs

- `docs/doc-seed-members.md` (new) — operator runbook: exact CSV column names, how to export from Google Sheets, dry-run instructions, interpreting output, how to roll back a bad row (delete from `auth.users` — Supabase cascades).
- `docs/devjournal.md` — dated entry documenting the migration.
- `CLAUDE.md` — seeds mentioned in the Commands section.

## Verification

1. Export the Google Sheet to `scripts/members.csv` (local only, gitignored).
2. `npm run seed:programs` → curated program rows created.
3. `npm run seed:members -- --dry-run --limit 3` → prints intent for 3 rows.
4. `npm run seed:members -- --limit 3` → creates 3 `auth.users`, 3 `profiles`, matching `profilePrograms`. Emails appear in Inbucket.
5. Re-run step 4 → `skipped: 3` (idempotency).
6. Open one invitation email → click → lands on `/` as that member. Profile fully populated; `emergencyContact` visible on `/api/me`.
7. `npm run seed:members` (no limit) → all 40 members seeded.
8. Flag yourself admin via the SQL above. Sign back in. Verify `isAdmin: true` on `/api/me`.
9. `npm test` green.
