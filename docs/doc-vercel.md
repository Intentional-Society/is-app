# Vercel — Configuration Reference

Current configuration for the Vercel project as deployed. This documents settings made in the Vercel dashboard that are not captured in code.

---

- **Project name:** `is-app-vercel`
- **Framework preset:** Next.js (must be set manually — Vercel does not auto-detect from an existing repo)
- **Domain:** `app.intentionalsociety.org` (DNS configured to point to Vercel)
- **Deployment Protection:** Vercel Authentication disabled on preview deployments, so GitHub Actions can run Playwright e2e tests against preview URLs without hitting a login wall
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `DATABASE_URL` — set in Vercel dashboard (Settings → Environment Variables), not committed to the repo
