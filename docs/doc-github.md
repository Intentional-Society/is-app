# GitHub — Configuration Reference

Settings made in the GitHub dashboard that are not captured in code.

---

## Repository

- **Org:** Intentional-Society
- **Repo:** is-app (public)
- **Default branch:** main

## Pull request settings

Settings → General → Pull Requests. Enforces the merge-commit default from `docs/strategy-branching.md` at the platform level.

- ✓ **Allow merge commits** — the "Create a merge commit" button. Default merge method; preserves the branch boundary in main's history.
- ☐ **Allow squash merging** — off. Removes the per-PR escape hatch so the merge UI can't collapse a PR's commits.
- ☐ **Allow rebase merging** — off. "Rebase and merge" replays branch commits onto main without a merge commit, losing the branch boundary; disabling it prevents the wrong method being clicked.
- ✓ **Always suggest updating pull request branches** — surfaces an "Update branch" prompt when `main` advances. The prompt's default action merges `main` into the branch, which the strategy avoids; treat it as a reminder to rebase locally rather than as an instruction to click.
- ☐ **Allow auto-merge** — off. "Auto-merge" only waits for *required* status checks. e2e can't be required today: it triggers on `deployment_status`, which docs-only PRs skip (no Vercel deploy → no event → the required check would never appear → the PR couldn't merge). Re-enable once `e2e.yml` short-circuits docs-only PRs the way `ci.yml` does and becomes a required check.
- **Default merge commit title:** PR title. **Default merge commit message:** PR description. Otherwise the merge commit reads "Merge pull request #N from …" and loses the context the PR body already carries.

`deleteBranchOnMerge` stays off at the repo level; the per-PR `--delete-branch` flag on `gh pr merge` handles cleanup explicitly. Apply or audit these via `gh api repos/Intentional-Society/is-app -X PATCH` (fields: `allow_merge_commit`, `allow_squash_merge`, `allow_rebase_merge`, `allow_update_branch`, `allow_auto_merge`, `merge_commit_title`, `merge_commit_message`).

## Branch protection on `main`

Enforced via a GitHub Ruleset, managed as code in `scripts/update-main-branch-protection.mjs`. Edit the rules there and run `npm run update_main_branch_protection` to push the changes to GitHub. Current rules:

- **PR required** for every change — even solo pushes, so the `pull_request` workflow trigger gates every merge into main.
- **Required status check:** "Lint & Functional Tests". E2E is not required: it triggers on `deployment_status`, which docs-only PRs skip (Vercel's `ignoreCommand` suppresses the deploy), so making it required would block every docs PR forever. Check manually before merging until `e2e.yml` is reworked to short-circuit docs-only PRs the way `ci.yml` does.
- **Branches must be up to date with `main`** before merging (`strict_required_status_checks_policy: true`). Forces the rebase-when-main-moves convention from `docs/strategy-branching.md` — the merge button stays disabled until the branch is rebased and CI passes on the rebased SHA. The rule enforces *up-to-date*, not *via-rebase*; clicking GitHub's "Update branch" button instead would merge `main` in, which the strategy avoids.
- **Force-push blocked** and **deletion blocked**.
- **Zero required approvals globally** — keeps solo work on app code unblocked.
- **Code-owner review required** on paths listed in `.github/CODEOWNERS` (currently `.github/workflows/` and `.github/CODEOWNERS` itself). A CI-secret-touching workflow change can't land without a second codeowner's approval.
- **Repository Admin can bypass per-PR** by ticking the bypass checkbox in the merge box (`bypass_mode: "pull_request"`). Not silent — admin merges that don't tick it still enforce every rule, including codeowner review. Previously was `"always"`, which silently skipped every rule for admins and defeated the codeowner gate; tightened after PR #159 merged without triggering review.

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
