# Supabase — Configuration Reference

Covers both the hosted production project (configured via the Supabase dashboard) and the local development stack (configured via `supabase/config.toml`).

---

## Magic-link flow (PKCE)

The magic-link sign-in flow uses PKCE. When a user requests a link, the client stores a `code_verifier` secret in a browser cookie (`sb-<ref>-auth-token-code-verifier`). The `/auth/callback` handler needs that cookie to exchange the `code` for a session.

Consequence: **the magic link must be opened in the same browser that requested it.** Clicking the link from a phone when the request came from a desktop, or opening it in an incognito window, fails with "exchange failed". Applies equally to the hosted and local stacks.

---

## `/login` vs `/signup` — who creates the user row

`/login` calls `signInWithOtp({ email, options: { shouldCreateUser: false } })`. `/signup` omits `shouldCreateUser` (defaults to `true`) and passes `options: { data: { displayName } }`, which GoTrue stores as `raw_user_meta_data` on user creation. The callback reads `user_metadata.displayName` to populate the `profiles` row.

Two reasons to keep `/login` non-creating:

1. **Spam / accidental rows.** Without `shouldCreateUser: false`, any bot or typo-er submitting an unknown email to `/login` creates a row in `auth.users` with empty metadata. Closing that off means `/signup` is the only path to user creation.
2. **Display-name integrity.** GoTrue only applies `options.data` on user *creation*, never on subsequent sign-ins. If a visitor had ever pre-existed (even from a mistyped `/login`), the display name they type on `/signup` would silently fail to reach `user_metadata` and their profile would land with `display_name = NULL`.

Tradeoff: GoTrue returns HTTP 422 (`otp_disabled`) for unknown emails and 200 for known ones, so the `/otp` endpoint is an account-enumeration oracle at the network layer. The login form surfaces the 422 as a human-readable "no account found" message rather than swallowing it — UI-level hiding wouldn't change the network-visible signal, and silently showing "check your email" confuses genuine typo-ers. Closing enumeration for real would require proxying OTP through our own endpoint (shuttling a PKCE challenge round-trip) or adding CAPTCHA.

---

## E2E test users (seeded manually)

The Playwright e2e suite signs in as two long-lived users instead of admin-provisioning a fresh user per run. This keeps `SUPABASE_SECRET_KEY` out of CI — the only secrets the Playwright job needs are two passwords and a reset token, each with a tightly scoped blast radius.

**Accounts (seed these once via the Supabase dashboard → Authentication → Users → Add user):**

- `e2e-regular@testfake.local` — standard member. Used by welcome/invites/logout/session-helper specs.
- `e2e-admin@testfake.local` — admin member. Not yet used by any spec; reserved for future admin-surface tests. After creating the user, set `profiles.is_admin = true` for this row via the SQL editor.

Both users should be created with "Auto Confirm User" checked so they can sign in with a password immediately.

**Secrets (set in GitHub Actions → Settings → Secrets → Actions, and as Vercel preview/dev env vars for `CI_RESET_TOKEN`):**

- `E2E_REGULAR_PASSWORD` — the password for `e2e-regular@testfake.local`. GH Actions only.
- `E2E_ADMIN_PASSWORD` — the password for `e2e-admin@testfake.local`. GH Actions only.
- `CI_RESET_TOKEN` — arbitrary random string. Must be identical in GH Actions **and** Vercel's Preview + Development env vars. The Playwright suite sends it in the `x-ci-reset-token` header; the server accepts the call only when the header matches and `VERCEL_ENV !== "production"`.

**Blast radius if leaked:**

- Passwords: attacker can sign in as one of two fake accounts. Regular sees its own profile + up to 10 self-created invites. Admin sees whatever admin surface exists (currently a `NotImplemented` stub). Rotate by changing the password in the Supabase dashboard.
- Reset token: attacker can wipe the profile fields + delete invites for those two accounts, on preview/dev only (404s in production). Rotate by generating a new string and updating both the GH secret and Vercel env var.

**Reset endpoint:** `POST /api/_test/reset`, token-gated + `VERCEL_ENV`-gated. Defined in `src/server/test-reset.ts`; the Playwright setup project (`tests/e2e/reset.setup.ts`) calls it once at the top of every run.

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
  - `https://app.intentionalsociety.org/auth/callback*` — production
  - `https://is-app-vercel-*-intentional-society-vercel.vercel.app/auth/callback*` — Vercel preview deploys (wildcard)

Local dev does **not** need entries here — it hits the local Supabase stack, whose allowlist is in `supabase/config.toml`. Only add `localhost` / `127.0.0.1` to this prod allowlist if a developer intentionally points their local frontend at prod Supabase (rare, and sends real magic-link emails).

The trailing `*` matters: the invite-signup flow from `/signup` passes `emailRedirectTo: \`${origin}/auth/callback?invite=<code>\``, and Supabase's allowlist matches URLs verbatim unless a wildcard is present. Without the `*`, Supabase would reject that URL and silently fall back to **Site URL** — stranding the prospective member at `/` with no session. The plain sign-in path (`login-form.tsx`) passes the bare `/auth/callback`, which also matches `/auth/callback*`.

### Auth providers

- **Email (magic link):** enabled. No password-based sign-in.

### API keys

- **Publishable default key:** exposed to the browser as `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
- **Service role key:** not currently used by the app; keep secret if ever needed

Both are set as Vercel environment variables (see `docs/doc-vercel.md`), not committed to the repo.

### Data API (PostgREST / GraphQL) — kept off

The hosted project's auto-generated **Data API** is disabled at the dashboard toggle: Project → Integrations → Data API → "Enable Data API". With it off, requests to `https://<project>.supabase.co/rest/v1/*` and `/graphql/v1` return HTTP 503 (`PGRST002`) for every table — the publishable key remains valid for `auth/v1` but cannot reach data.

**Why it stays off.** Authorization logic lives in the Hono middleware (`src/server/auth-middleware.ts`), so PostgREST and pg_graphql add attack surface without adding capability. RLS denies `anon` and `authenticated` on every table as a backstop (see `docs/architecture-appstack.md`), so flipping the toggle on would not directly expose data — but it would put every table one RLS-policy bug away from a leak, and create a parallel access path that bypasses the request logging, validation, and shape-checking in the Hono layer.

Keeping the Data API off leaves a single door to the database: the Hono API at `src/server/api.ts`, which connects via the `postgres` superuser in `DATABASE_URL` (a server-only env var).

---

## Local stack

The local Supabase stack (spun up by `supabase start`, wrapped by `npm run dev:db`) is configured in `supabase/config.toml`. Any change there requires `npx supabase stop && npx supabase start` — the CLI doesn't hot-reload config.

### `[auth]` — URL Configuration

Same silent-fallback semantics as prod: if `emailRedirectTo` from the client isn't in the allowlist, Supabase falls back to `site_url`.

- **`site_url`** — `http://127.0.0.1:3000`
- **`additional_redirect_urls`** — must include `/auth/callback` for both `127.0.0.1:3000` and `localhost:3000`, because `window.location.origin` depends on which host the dev server was opened with.

### Inbucket (local email catcher)

`supabase start` also spins up Inbucket at **http://localhost:54324**. All outbound email — magic links, invites, any future notifications — lands there instead of real inboxes. Open the URL, click the mailbox matching your email's local-part, open the most recent message, click the link. No external SMTP is configured for local dev.

### API keys

The CLI-generated local keys are written to `.env.local` by `npm run setup`. They mirror the prod env var names (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`) but point at `http://127.0.0.1:54321`.

### Studio

The local Supabase dashboard equivalent runs at **http://localhost:54323** (DB browser, auth user management, SQL editor).
