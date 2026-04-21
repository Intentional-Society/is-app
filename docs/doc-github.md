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
- **Zero required approvals** (solo dev).
- **Repository Admin can bypass** for emergencies (CI wedged, urgent revert).

## CI workflows

- `.github/workflows/ci.yml` — lint + functional tests, triggers on `pull_request` to main. Spins up the full local Supabase stack via `supabase/setup-cli@v1` + `supabase start`, then applies Drizzle migrations before running Vitest. Functional tests that hit the DB (e.g. `profiles.test.ts`) run against this stack, matching the dev-box setup exactly.
- `.github/workflows/e2e.yml` — Playwright against Vercel preview URL, triggers on `deployment_status` (fired by Vercel's GitHub integration when a preview deploy completes).
- `.github/workflows/codeql.yml` — CodeQL static analysis on JS/TS and workflow YAMLs, triggers on PRs + pushes to main + weekly cron. Uses the `security-extended` query pack.

## Advanced Security

Enabled in Settings → Code security. All free on public repos.

- **Dependabot alerts** — surfaces advisories for dependencies on the default branch. Open alerts: `/security/dependabot`.
- **Dependabot updates** — weekly automated version-bump PRs, configured in `.github/dependabot.yml` (npm patch+minor batched; github-actions tracked separately). Security advisories still arrive immediately, independent of the schedule.
- **Secret Protection** — combines secret scanning (flags known-pattern secrets already in the repo) and push protection (blocks new commits containing them before they land on the server).
- **Private vulnerability reporting** — lets researchers file reports privately via the Security tab instead of a public issue. Open reports: `/security/advisories`.
- **Code scanning** — CodeQL, see workflow above. Results land in `/security/code-scanning`.
