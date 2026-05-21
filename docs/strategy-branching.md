# Branch Strategy

## Current approach: trunk-based development with continuous deployment

We use a single `main` branch (the trunk) with short-lived feature branches. Feature branches PR into `main`, and `main` auto-deploys to production on Vercel. There is no staging branch or staging environment.

This is a deliberate choice toward Continuous Deployment — code that passes CI goes to production.

## Why no staging/release branch distinction

A `develop`/staging branch adds a layer of safety (preview new features before they hit real users) but also adds cognitive cost (which branch is this on? which environment has what?) and slows delivery to users. For a small team deploying to a forgiving user base, we're starting simple and trying to build up our CI muscles.

The alternative was considered: a `release` branch with its own Vercel environment (configurable in Vercel Settings → Environments → Branch Tracking), with and periodic `main → release` PRs for production releases. This remains available if we need it.

## When to reconsider

When production breaks happen, the question to ask is: **"do we strengthen CI, or add a staging branch?"** The hypothesis is that stronger CI (better tests, migration checks, linting) is the higher-leverage answer — especially with AI-assisted development — but we're open to being wrong.

## TODO: We need to support a "dev environment"
This requires separate-from-prod dev-testing database(s) for the e2e tests. We also want a "copy prod data to testing db" for testing the preview deploys, to give us db migration testing against real data.

## Feature branch conventions

- Branch from `main`
- PR back into `main`
- CI must pass before merge (lint, functional tests, e2e against Vercel preview)
- Keep branches short-lived

### Keeping the branch current

When `main` advances mid-PR, rebase the branch onto it (`git fetch origin && git rebase origin/main && git push --force-with-lease`); don't merge `main` in. Conflicts get resolved once during the rebase, the eventual PR merge stays conflict-free, and the branch keeps a linear history with no inner merge commits.

Branch protection enforces *up-to-date-with-main* before the merge button works (`strict_required_status_checks_policy: true`), so this isn't optional. The rule doesn't enforce *via rebase*, though — GitHub's "Update branch" button would merge `main` in instead, which the convention above avoids.

### Merging the PR

Default to a merge commit (`gh pr merge --merge --delete-branch`). The merge commit preserves the branch boundary: `git log --first-parent main` reads as one line per PR, with each PR's individual commits still reachable through the merge commit's second parent. Squash loses the commits; rebase keeps the commits but loses the boundary.

`--delete-branch` removes the local and remote branch copies in one shot. Repository settings disable squash and rebase merging entirely, so the merge button can't pick a different method by accident — see `docs/doc-github.md` for the full PR settings.
