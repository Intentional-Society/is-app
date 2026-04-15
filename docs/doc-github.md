# GitHub — Configuration Reference

Settings made in the GitHub dashboard that are not captured in code.

---

## Repository

- **Org:** Intentional-Society
- **Repo:** is-app (private)
- **Default branch:** main

## Branch protection on `main`

**Not currently enabled.** Requires GitHub Pro/Team plan for private repos. The intended configuration when available:

- **Required status checks:** "Lint & Functional Tests" must pass before merge
- **Require branches to be up to date:** yes — PR must be rebased on latest main
- **Enforce for admins:** no (allows emergency bypass)
- **Required reviewers:** none (can add later as team grows)
- **E2E (Playwright):** not a required check — runs separately via `deployment_status` trigger and posts results to the PR but doesn't block merge

Until branch protection is enabled, rely on team discipline: don't merge a PR with failing checks.

## CI workflows

- `.github/workflows/ci.yml` — lint + functional tests, triggers on `pull_request` to main. Spins up the full local Supabase stack via `supabase/setup-cli@v1` + `supabase start`, then applies Drizzle migrations before running Vitest. Functional tests that hit the DB (e.g. `profiles.test.ts`) run against this stack, matching the dev-box setup exactly.
- `.github/workflows/e2e.yml` — Playwright against Vercel preview URL, triggers on `deployment_status` (fired by Vercel's GitHub integration when a preview deploy completes)
