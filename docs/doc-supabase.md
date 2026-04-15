# Supabase — Configuration Reference

Current configuration for the Supabase project as deployed. This documents settings made in the Supabase dashboard that are not captured in code.

---

- **Project ref:** `oyuzjowguujwhqyhijzx`
- **Dashboard:** https://supabase.com/dashboard/project/oyuzjowguujwhqyhijzx
- **Region:** (whichever was selected at project creation — see dashboard)
- **Database:** Postgres managed by Supabase. Drizzle is the sole migration tool — `supabase/migrations/` is unused.

## Authentication → URL Configuration

These settings control where Supabase redirects users after magic-link sign-in. If `emailRedirectTo` passed from the client is not on the **Redirect URLs** allowlist, Supabase silently falls back to **Site URL** — so both must be kept in sync with the deployment topology.

- **Site URL:** `https://app.intentionalsociety.org`
- **Redirect URLs** (allowlist):
  - `https://app.intentionalsociety.org/auth/callback` — production
  - `https://is-app-vercel-*-intentional-society-vercel.vercel.app/auth/callback` — Vercel preview deploys (wildcard)
  - `http://localhost:3000/auth/callback` — local dev

The client passes `emailRedirectTo: \`${window.location.origin}/auth/callback\`` from `src/app/login/login-form.tsx`, so adding a new deploy target only requires adding its `/auth/callback` URL to the allowlist above.

## Auth providers

- **Email (magic link):** enabled. No password-based sign-in.

## API keys

- **Publishable default key:** exposed to the browser as `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
- **Service role key:** not currently used by the app; keep secret if ever needed

Both are set as Vercel environment variables (see `docs/doc-vercel.md`), not committed to the repo.
