# Supabase — Configuration Reference

Covers both the hosted production project (configured via the Supabase dashboard) and the local development stack (configured via `supabase/config.toml`).

---

## Magic-link flow (PKCE)

The magic-link sign-in flow uses PKCE. When a user requests a link, the client stores a `code_verifier` secret in a browser cookie (`sb-<ref>-auth-token-code-verifier`). The `/auth/callback` handler needs that cookie to exchange the `code` for a session.

Consequence: **the magic link must be opened in the same browser that requested it.** Clicking the link from a phone when the request came from a desktop, or opening it in an incognito window, fails with "exchange failed". Applies equally to the hosted and local stacks.

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
  - `https://app.intentionalsociety.org/auth/callback` — production
  - `https://is-app-vercel-*-intentional-society-vercel.vercel.app/auth/callback` — Vercel preview deploys (wildcard)
  - `http://localhost:3000/auth/callback` — local dev

The client passes `emailRedirectTo: \`${window.location.origin}/auth/callback\`` from `src/app/login/login-form.tsx`, so adding a new deploy target only requires adding its `/auth/callback` URL to the allowlist above.

### Auth providers

- **Email (magic link):** enabled. No password-based sign-in.

### API keys

- **Publishable default key:** exposed to the browser as `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
- **Service role key:** not currently used by the app; keep secret if ever needed

Both are set as Vercel environment variables (see `docs/doc-vercel.md`), not committed to the repo.

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
