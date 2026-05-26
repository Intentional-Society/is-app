# Supabase — Configuration Reference

Covers both the hosted production project (configured via the Supabase dashboard) and the local development stack (configured via `supabase/config.toml`).

---

## Magic-link flow (token-hash + verifyOtp)

The magic-link and password-reset emails embed `{{ .TokenHash }}` directly in a URL pointing at `/auth/callback?token_hash=…&type=…&next=…`. The route calls `supabase.auth.verifyOtp({ token_hash, type })` server-side, so the link works regardless of which browser opens it. The `next` query param carries the `emailRedirectTo` URL the form passed and tells the route where to land the user post-verification.

PKCE is still the configured client `flowType` and still governs session cookies / refresh-token rotation. Only the email-verification step is bypassed by the token-hash flow. See `docs/old-archive/plan-cross-browser-magic-link.md` for the migration rationale.

---

## `/signin` vs `/signup` — who creates the user row

`/signin` calls `signInWithOtp({ email, options: { shouldCreateUser: false } })`. `/signup` omits `shouldCreateUser` (defaults to `true`) and passes `options: { data: { displayName } }`, which GoTrue stores as `raw_user_meta_data` on user creation. The callback reads `user_metadata.displayName` to populate the `profiles` row.

Two reasons to keep `/signin` non-creating:

1. **Spam / accidental rows.** Without `shouldCreateUser: false`, any bot or typo-er submitting an unknown email to `/signin` creates a row in `auth.users` with empty metadata. Closing that off means `/signup` is the only path to user creation.
2. **Display-name integrity.** GoTrue only applies `options.data` on user *creation*, never on subsequent sign-ins. If a visitor had ever pre-existed (even from a mistyped `/signin`), the display name they type on `/signup` would silently fail to reach `user_metadata` and their profile would land with `display_name = NULL`.

Tradeoff: GoTrue returns HTTP 422 (`otp_disabled`) for unknown emails and 200 for known ones, so the `/otp` endpoint is an account-enumeration oracle at the network layer. The sign-in form surfaces the 422 as a human-readable "no account found" message rather than swallowing it — UI-level hiding wouldn't change the network-visible signal, and silently showing "check your email" confuses genuine typo-ers. Closing enumeration for real would require proxying OTP through our own endpoint (shuttling a PKCE challenge round-trip) or adding CAPTCHA.

---

## E2E test users (seeded manually)

The Playwright e2e suite signs in as two long-lived users instead of admin-provisioning a fresh user per run. This keeps `SUPABASE_SECRET_KEY` out of CI — the only secrets the Playwright job needs are two passwords and a reset token, each with a tightly scoped blast radius.

**Accounts (seed these once via the Supabase dashboard → Authentication → Users → Add user):**

- `e2e-regular@testfake.local` — standard member. Used by welcome/invites/signout/session-helper specs.
- `e2e-admin@testfake.local` — admin member. Used by `tests/e2e/admin.spec.ts`. **This account must have `profiles.is_admin = true`** — without it `/admin` calls `notFound()` and the admin specs fail. The `profiles` row is created on first sign-in (via the `/api/me` self-heal); set the flag for it in the SQL editor.

Both users should be created with "Auto Confirm User" checked so they can sign in with a password immediately.

**Secrets (set in GitHub Actions → Settings → Secrets → Actions, and as a Vercel env var across all environments for `CI_RESET_TOKEN`):**

- `E2E_REGULAR_PASSWORD` — the password for `e2e-regular@testfake.local`. GH Actions only.
- `E2E_ADMIN_PASSWORD` — the password for `e2e-admin@testfake.local`. GH Actions only.
- `CI_RESET_TOKEN` — arbitrary random string. Must be identical in GH Actions **and** Vercel's Production + Preview + Development env vars. The Playwright suite sends it in the `x-ci-reset-token` header; the server accepts the call only when the header matches.

**Blast radius if leaked:**

- Passwords: attacker can sign in as one of two fake accounts. Regular sees its own profile + up to 10 self-created invites. Admin additionally sees the admin surface (app settings, relation hints, program administration). Rotate by changing the password in the Supabase dashboard.
- Reset token: attacker can wipe the profile fields + delete invites for those two accounts, on any environment (preview and prod share the same Supabase). Rotate by generating a new string and updating both the GH secret and Vercel env var.

**Reset endpoint:** `POST /api/_test/reset`, token-gated. Defined in `src/server/test-reset.ts`; the Playwright setup project (`tests/e2e/reset.setup.ts`) calls it once at the top of every run. The token is the sole gate — preview and prod share one Supabase, so an environment gate would be theatre against a token that already mutates prod data either way. The destructive scope is fixed at the seeded e2e users, not arbitrary rows.

---

## Production (hosted)

- **Project ref:** `oyuzjowguujwhqyhijzx`
- **Dashboard:** https://supabase.com/dashboard/project/oyuzjowguujwhqyhijzx
- **Region:** (whichever was selected at project creation — see dashboard)
- **Database:** Postgres managed by Supabase. Drizzle is the sole migration tool — `supabase/migrations/` is unused.

### Authentication → URL Configuration

These settings control where Supabase redirects users after magic-link sign-in. If `emailRedirectTo` passed from the client is not on the **Redirect URLs** allowlist, Supabase silently falls back to **Site URL** — so both must be kept in sync with the deployment topology.

- **Site URL:** `https://app.intentionalsociety.org`
- **Redirect URLs** (allowlist):
  - `https://app.intentionalsociety.org/*` — production
  - `https://is-app-vercel-*-intentional-society-vercel.vercel.app/*` — Vercel preview deploys (wildcard)

Local dev does **not** need entries here — it hits the local Supabase stack, whose allowlist is in `supabase/config.toml`. Only add `localhost` / `127.0.0.1` to this prod allowlist if a developer intentionally points their local frontend at prod Supabase (rare, and sends real magic-link emails).

The bare `/*` covers all three `emailRedirectTo` targets the forms pass: `/` (signin), `/?invite=<code>` (signup), and `/auth/reset-password` (forgot-password). Anything more specific would need a separate entry per target. Without a matching wildcard, Supabase rejects the URL and silently falls back to **Site URL**, stranding the user at `/` with no session.

### Auth providers

- **Email (magic link):** enabled — primary sign-in path.
- **Email + password:** enabled — backs the password-reset flow at `/forgot-password` and the change-password form in profile edit. Sign-in via password is also possible from `/signin` for any member who has set one.

### Authentication → SMTP

Production routes auth emails through custom SMTP (Resend). Configure under Authentication → SMTP Settings:

- **Host:** `smtp.resend.com`
- **Port:** `587` (STARTTLS)
- **Username:** `resend`
- **Password:** Resend API key (from Resend dashboard → API Keys)
- **Sender email:** `devteam@mail.intentionalsociety.org`
- **Sender name:** `Intentional Society Web App` (see `docs/doc-resend.md` for why this differs from the newsletter sender and what it implies for in-product copy).

Also raise Authentication → Rate Limits → "emails sent per hour" from the default 30/hour. We use **50/hour** — chosen to sit comfortably below Resend's free-tier 100/day cap so that a misconfiguration or runaway loop hits Supabase's per-hour cap long before exhausting Resend's daily allotment, leaving headroom to fix the issue and send legitimate mail afterward. The custom SMTP path no longer hits the built-in 2/hour cap once Custom SMTP is enabled, but Supabase still applies its own per-project rate limit.

Local dev does not route through Resend — the local stack uses Inbucket (see "Local stack → Inbucket" below).

See `docs/doc-resend.md` for why Resend over alternatives, the sending-domain rationale, and reply routing.

### Authentication → Email templates

Auth email templates (magic link, signup confirmation, password recovery) are **managed from the repo**, not the dashboard. Source files live in `supabase/templates/` with a manifest at `supabase/templates/templates.manifest.mjs`. The local stack picks them up via `[auth.email.template.*]` blocks in `supabase/config.toml`. To update prod, edit the files and run `npm run update_email_templates` — the script PATCHes the Supabase Management API and overwrites whatever's in the dashboard. Dashboard edits will be silently clobbered on the next push; the repo wins. `npm run download_email_templates` snapshots the current hosted state to the committed `supabase/templates/_remote-snapshot/` directory — run it before each push so the snapshot stays current and the PR diff shows exactly what's changing for recipients.

Design and rationale: `docs/design-emails.md`.

### Personal access token (Management API)

`scripts/update-email-templates.mjs` (and any future operator scripts that hit the Supabase Management API) authenticate with a **personal access token**, account-scoped — not project-scoped, not a Vercel env var.

- **Generate at:** https://supabase.com/dashboard/account/tokens. Any descriptive name is fine; we use one named for the script that consumes it.
- **Purpose:** lets the operator push email templates from the repo to the hosted project's auth config via `PATCH /v1/projects/{ref}/config/auth`, and download the current state for snapshotting. No app code path uses it.
- **Storage:** read from `.env.prod` (gitignored via `.env.*`) as `SUPABASE_ACCESS_TOKEN`, matching the prod-targeting convention used by `scripts/import-members-csv.ts` and `scripts/normalize-referrals.ts`. Treat the file as temporary — create it with the token, run the script, delete the file. Never commit, never set in Vercel, never put in CI.
- **Blast radius if leaked:** broad — a personal access token can do anything the issuing account can do across every Supabase project that account belongs to, including reading API keys, mutating auth config, and managing databases. Revoke at the same URL and regenerate if exposed.
- **Rotation:** revoke + regenerate at the dashboard. No app-side coordination needed; the next script run reads the new value from `.env.prod`.

### API keys

- **Publishable default key:** exposed to the browser as `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
- **Secret key:** used server-side by `src/lib/supabase/admin.ts` for avatar Storage operations (upload, signing, delete) and by the e2e session helper; exposed as `SUPABASE_SECRET_KEY`. Never sent to the browser.

Both are set as Vercel environment variables (see `docs/doc-vercel.md`), not committed to the repo.

### Data API (PostgREST / GraphQL) — kept off

The hosted project's auto-generated **Data API** is disabled at the dashboard toggle: Project → Integrations → Data API → "Enable Data API". With it off, requests to `https://<project>.supabase.co/rest/v1/*` and `/graphql/v1` return HTTP 503 (`PGRST002`) for every table — the publishable key remains valid for `auth/v1` but cannot reach data.

**Why it stays off.** Authorization logic lives in the Hono middleware (`src/server/auth-middleware.ts`), so PostgREST and pg_graphql add attack surface without adding capability. RLS denies `anon` and `authenticated` on every table as a backstop (see `docs/architecture-appstack.md`), so flipping the toggle on would not directly expose data — but it would put every table one RLS-policy bug away from a leak, and create a parallel access path that bypasses the request logging, validation, and shape-checking in the Hono layer.

Keeping the Data API off leaves a single door to the database: the Hono API at `src/server/api.ts`, which connects via the `postgres` superuser in `DATABASE_URL` (a server-only env var).

### Storage — `avatars` bucket

Profile pictures (issue #131) live in a Storage bucket named **`avatars`**. Create it once in the dashboard (Storage → New bucket) to match the local declaration in `supabase/config.toml`:

- **Name:** `avatars`
- **Public:** off — objects are served via short-lived signed URLs
- **File size limit:** 1 MB (the field takes decimal MB/KB/B units, not MiB)
- **Allowed MIME types:** `image/webp`

The server reaches Storage with the **secret key** (`src/lib/supabase/admin.ts`), which bypasses Storage RLS — so no bucket policies are needed, the same posture as the `postgres` superuser for the database.

---

## Local stack

The local Supabase stack (spun up by `supabase start`, wrapped by `npm run dev:db`) is configured in `supabase/config.toml`. Any change there requires `npx supabase stop && npx supabase start` — the CLI doesn't hot-reload config.

### `[auth]` — URL Configuration

Same silent-fallback semantics as prod: if `emailRedirectTo` from the client isn't in the allowlist, Supabase falls back to `site_url`.

- **`site_url`** — `http://127.0.0.1:3000`
- **`additional_redirect_urls`** — bare `/*` for both `127.0.0.1:3000` and `localhost:3000`, since `window.location.origin` depends on which host the dev server was opened with and the wildcard covers all three form redirect targets.

### Inbucket (local email catcher)

`supabase start` also spins up Inbucket at **http://localhost:54324**. All outbound email — magic links, invites, any future notifications — lands there instead of real inboxes. Open the URL, click the mailbox matching your email's local-part, open the most recent message, click the link. No external SMTP is configured for local dev.

### API keys

The CLI-generated local keys are written to `.env.local` by `npm run setup`. They mirror the prod env var names (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`) but point at `http://127.0.0.1:54321`.

### Studio

The local Supabase dashboard equivalent runs at **http://localhost:54323** (DB browser, auth user management, SQL editor).
