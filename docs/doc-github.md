# GitHub — Configuration Reference

Settings made in the GitHub dashboard that are not captured in code.

---

## Repository

- **Org:** Intentional-Society
- **Repo:** is-app (public)
- **Default branch:** main

## Branch protection on `main`

Enforced via a GitHub Ruleset, managed as code in `scripts/update-main-branch-protection.mjs`. Edit the rules there and run `npm run update_main_branch_protection` to push the changes to GitHub. Current rules:

- **PR required** for every change — even solo pushes, so the `pull_request` workflow trigger gates every merge into main.
- **Required status check:** "Lint & Functional Tests" (E2E is not required — it runs post-deploy against the Vercel preview and can flake on cold start; check manually before merging).
- **Force-push blocked** and **deletion blocked**.
- **Zero required approvals globally** — keeps solo work on app code unblocked.
- **Code-owner review required** on paths listed in `.github/CODEOWNERS` (currently `.github/workflows/` and `.github/CODEOWNERS` itself). A CI-secret-touching workflow change can't land without a second codeowner's approval.
- **Repository Admin can bypass** for emergencies (CI wedged, urgent revert).

## CI workflows

- `.github/workflows/ci.yml` — lint + functional tests, triggers on `pull_request` to main. Spins up the full local Supabase stack via `supabase/setup-cli@v1` + `supabase start`, then applies Drizzle migrations before running Vitest. Functional tests that hit the DB (e.g. `profiles.test.ts`) run against this stack, matching the dev-box setup exactly.
- `.github/workflows/e2e.yml` — Playwright against Vercel preview URL, triggers on `deployment_status` (fired by Vercel's GitHub integration when a preview deploy completes). Job-level `if:` filters on `environment` ∈ {`Production`, `Preview`} so unrelated GitHub Deployments (e.g. `prod-db`) don't accidentally invoke Playwright with a github.com URL.
- `.github/workflows/codeql.yml` — CodeQL static analysis on JS/TS and workflow YAMLs, triggers on PRs + pushes to main + weekly cron. Uses the `security-extended` query pack.
- `.github/workflows/forward-migrate-prod-schema-expansion.yml` — `workflow_dispatch`-only. Applies additive (expand) drizzle migrations to the prod DB ahead of opening a PR, so previews can exercise new code paths against the migrated schema. Bound to the `prod-db` environment (see below) for the reviewer gate. Triggered locally via `npm run prod:db:expand` (uses the current branch). Contract migrations do NOT use this workflow — they ride the standard merge-to-main path.

## Environments

- **`prod-db`** — gates write access to the production Supabase database from any `workflow_dispatch` workflow. Configured in Settings → Environments.
  - **Required reviewers:** James (self-approval permitted; this is a single-maintainer setup).
  - **Environment secret:** `PRODUCTION_DATABASE_URL` — the prod transaction-pooler URL (same value Vercel uses on production deploys, copied from the Vercel project's env).
  - The name is deliberately distinct from "production" to avoid visual collision with Vercel's `VERCEL_ENV=production`, which has its own meaning in `vercel.json`.

## Advanced Security

Enabled in Settings → Code security. All free on public repos.

- **Dependabot alerts** — surfaces advisories for dependencies on the default branch. Open alerts: `/security/dependabot`.
- **Dependabot updates** — weekly automated version-bump PRs, configured in `.github/dependabot.yml` (npm patch+minor batched; github-actions tracked separately). Security advisories still arrive immediately, independent of the schedule.
- **Secret Protection** — combines secret scanning (flags known-pattern secrets already in the repo) and push protection (blocks new commits containing them before they land on the server).
- **Private vulnerability reporting** — lets researchers file reports privately via the Security tab instead of a public issue. Open reports: `/security/advisories`.
- **Code scanning** — CodeQL, see workflow above. Results land in `/security/code-scanning`.
