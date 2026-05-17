# Vercel — Configuration Reference

Current configuration for the Vercel project as deployed. This documents settings made in the Vercel dashboard that are not captured in code.

---

- **Team:** `intentional-society-vercel`
- **Project name:** `is-app-vercel`
- **Dashboard:** https://vercel.com/intentional-society-vercel/is-app-vercel
- **Framework preset:** Next.js (must be set manually — Vercel does not auto-detect from an existing repo)
- **Build command:** `if [ "$VERCEL_ENV" = "production" ]; then npx drizzle-kit migrate; fi && next build` (set in `vercel.json`). Runs Drizzle migrations before the Next.js build on production deploys only — preview deploys skip migrations. If the production migration fails, the build aborts before `next build` and the previous production deploy keeps serving traffic.
- **Build machine:** `Elastic` (auto-sized 4–30 vCPUs / 8–60 GB, billed $0.0035 per CPU-minute). Vercel's current recommended default — the platform right-sizes each build automatically. Pin to a fixed tier (Standard / Enhanced / Turbo) in *Settings → Build and Deployment → Build Machine* if a project ever needs a guaranteed size.
- **Domain:** `app.intentionalsociety.org` (DNS configured to point to Vercel)
- **Deployment Protection:** Vercel Authentication disabled on preview deployments, so GitHub Actions can run Playwright e2e tests against preview URLs without hitting a sign-in wall
- **Integrations:** Axiom (Log Drain — streams all serverless function output to Axiom automatically)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `DATABASE_URL`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` — set in Vercel dashboard (Settings → Environment Variables), not committed to the repo

---

## Build times

Builds normally land around **30 seconds**. The Sentry source-map upload runs after the production compile (logged as "Sending telemetry data... to Sentry") and is the main variable component — usually quick, but occasionally spikes by ~60s on Sentry ingest latency. Treat those spikes as transient noise unless they persist across consecutive builds. If build-minute overages become a concern, the highest-leverage lever is gating source-map upload to `VERCEL_ENV=production` so preview builds skip it entirely.
