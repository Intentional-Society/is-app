---
name: ship
description: "[is-app] Orchestrate the full commit → PR → merge → post-merge-watch chain for a branch or PR in the Intentional Society repo. Invoke explicitly as `/ship [PR#|URL|issue-or-context]`. Delegates dirty / on-main states to `/pr` (which delegates to `/commit`). Fetches `origin/main`, rebases if needed, dispatches the schema-expand workflow when a schema expand is pending and waits for the `prod-db` approval gate + post-deploy e2e, watches all required and visible advisory pre-merge checks for up to 5 minutes (offering `wait+5` / `troubleshoot` / `abort` — never `proceed anyway`), runs `gh pr merge --merge --delete-branch` (the only valid merge form per repo settings), tidies the local branch, then watches `main` for up to 5 minutes for the production deploy and post-merge e2e. Fires only on explicit `/ship` invocation."
disable-model-invocation: true
---

# /ship

The orchestrator. `/ship` is the only way to run the chained commit → PR → merge sequence — there is no second path. It delegates downward (`/ship` → `/pr` → `/commit`) and never auto-acts past the merge: the post-merge watch reports, the human decides whether to hotfix or revert if anything goes red.

## Invocation

`/ship [PR#|URL|issue-or-context]`

Argument resolution: same order as `/pr` (PR URL → `gh pr view <N>` → `gh issue view <N>` → plain-language context).

**Branch-switching policy.** If `[PR#|URL]` resolves to a PR on a branch different from the current checkout, `/ship` **may** switch branches — but only after verifying the current branch's working tree is clean. If the tree is dirty, refuse with a suggestion to commit or stash; never auto-stash (see Stash safety below). `/pr` refuses to switch under all conditions; `/ship` is the only Skill that switches.

**No `--squash` flag.** Repo PR settings disable squash and rebase merging — only merge-commit is allowed. The merge command is always `gh pr merge --merge --delete-branch`. Re-enabling squash is a repo-policy decision, not a Skill flag.

Natural-language phrasings ("ship it", "merge this PR") are guidance, not triggers. With `disable-model-invocation: true`, this Skill fires only on explicit `/ship`.

## Steps

1. **Check `gh` auth.** `gh auth status`. If it fails, refuse and print `gh auth login`.

2. **Parse arguments; resolve target PR.** If the argument names a different branch AND the current working tree is clean, `git switch <target-branch>`. If the current working tree is dirty, refuse with a clear suggestion (commit or stash). Do not auto-stash.

3. **Working-tree pre-flight.** If dirty or on `main` with no PR for the current branch, delegate to `/pr` (which delegates to `/commit` per `/pr` step 4). **Immediately before invoking `/pr`, write the delegation marker `.claude/.nl-delegation-active` as `ship\t<current ISO-8601 UTC>`** so the delegated `/pr` (and, in turn, `/commit`) doesn't re-prompt for natural-language intent the human already gave by typing `/ship`. Each skill consumes the marker on read at its Step 0 (honoring it only if <30s old) and re-writes a fresh one before its own downstream delegation; **after `/pr` returns, delete the marker if it still exists** (cleanup). When `/pr` returns with a PR URL, continue.

4. **Fetch — no shallow shortcuts.** `git fetch origin main`. Do not use shallow-fetch shortcuts (`--depth=1` etc.) for freshness checks — a shallow fetch breaks `git merge-base` and was the root cause of a recent expand-workflow bug ([PR #254](https://github.com/Intentional-Society/is-app/pull/254)).

5. **Freshness check + rebase if needed.** Run `git merge-base --is-ancestor origin/main HEAD`. If it fails (main has moved), `git rebase origin/main`. On rebase conflict, abort and surface — do not auto-resolve.

6. **Re-gate after rebase.** If the rebase changed anything, re-run `npm test`, then `git push --force-with-lease`.

7. **Dispatch schema expand if pending.** If a schema expand from `/commit` is pending and not yet deployed, run `npm run prod:db:expand` to dispatch the `forward-migrate-prod-schema-expansion` workflow against the pushed branch.

   **While-you-wait narration.** The workflow pauses on a manual approval gate in the `prod-db` GitHub Actions environment before injecting production credentials. This gate can take minutes to hours depending on maintainer availability — that is expected and normal, not a hang. While waiting:

   - Surface the workflow run URL (so the human can find the approval button on the GitHub Actions page).
   - Surface the migration SQL preview (so the human can review what will be applied).
   - Surface the PR link (so the maintainer reviewing has full context).
   - Stay in the wait loop. Do not time out the way the CI wait at step 8 does — there is no realistic upper bound on team availability here.

   Once the workflow completes successfully, wait for the next `e2e.yml` run to fire on the post-deploy commit. Require it to pass before continuing to step 8. If the dispatch fails, maintainer approval is denied, or post-deploy e2e fails, surface the failing run and refuse.

8. **Wait for CI checks.** `gh pr checks <N> --watch`. The required check (`Lint & Functional Tests`) plus every visible advisory check (E2E, CodeQL, and any others present) must be green.

   Wait up to **5 minutes** for pending advisories. After 5 minutes, present three options:

   - `wait+5` — wait another 5 minutes.
   - `troubleshoot` — exit the wait loop and surface the still-pending check name(s) and URL(s) for human investigation.
   - `abort` — abandon the merge attempt.

   **There is no `proceed` option.** Anything not green blocks the merge.

9. **Docs-only PR handling.** If the PR's diff is confined to `docs/**` and root `CLAUDE.md`:

   - `ci.yml`'s `dorny/paths-filter` step skips the test steps but still posts `Lint & Functional Tests` green within seconds (satisfies branch protection).
   - Vercel preview is skipped per `vercel.json`'s `ignoreCommand`, so no preview `deployment_status` event fires and preview `e2e.yml` does not run.
   - Treat the absent pre-merge advisory checks (E2E, anything else gated on the preview deploy) as **expected** per `docs/doc-github.md`'s docs-only rule. Proceed on required-green only — do not wait for advisories that the docs-only path skipped by design.

10. **Merge confirmation policy.** The checked-in `.claude/settings.json` `ask` rule on `gh pr merge` (step 11) is the **sole** merge confirmation, in every case — whether `/ship` opened the PR during this run or the PR pre-existed. Do **not** add a separate conversational Y/n; the required one-line pre-merge narration (step 11) supplies the harness prompt's context. *(History: a path-dependent Y/n for the PR-created-this-run case was kept additively until the Thread-14 actual-`/ship`-path proof passed on 2026-06-24; removed here so the harness prompt is the one confirmation and that path no longer double-prompts. See `docs/plan-skill-nl-invocation.md`.)*

11. **Merge.** First print the **required pre-merge narration** — one line with PR number, title, and check posture (e.g. `Merging PR #123 "Add dark mode" — required green (Lint & Functional ✓); advisories: E2E ✓.`) — then run `gh pr merge <N> --merge --delete-branch`.

    - **Harness merge confirmation.** A checked-in `.claude/settings.json` `ask` rule on `Bash(gh pr merge *)` / `PowerShell(gh pr merge *)` makes the harness prompt a human to approve this exact command in every session — un-weakenable by a local `allow` or `bypassPermissions` (precedence is deny→ask→allow, first match). The required narration above gives that prompt context. This is the durable, model-proof merge confirmation. **Never add `allowed-tools: Bash(gh *)` (or any `gh` grant) to this Skill's frontmatter** — it would let the merge run without the human prompt and silently defeat this gate. **Note (#353):** this harness prompt is now the **sole** merge confirmation — step 10's conversational Y/n was removed (#353 fast-follow) after the Thread-14 actual-`/ship`-path proof passed (2026-06-24): the `ask` fired on the real `/ship` merge command, beat a local `allow`, and the human's decline left the PR unmerged. See `docs/plan-skill-nl-invocation.md`.
    - Do **not** pass `--merge-title` or `--body` flags. GitHub uses the PR title and body verbatim per the repo's `merge_commit_title: PR_TITLE` / `merge_commit_message: PR_BODY` settings; custom flags would override that and create inconsistent history.
    - Never `--admin`, `--auto`, force-merge, `--squash` (repo-disabled), or any branch-protection bypass.

12. **Tidy.** `git switch main && git pull --ff-only`. Then `git branch -d <feature-branch>` if the local branch still exists and is fully merged. The remote branch is auto-deleted on merge (`delete_branch_on_merge: true`); the explicit `--delete-branch` flag on `gh pr merge` covers both the local-cleanup intent and the rare case where remote deletion didn't happen.

13. **Capture merge SHA + discover post-merge runs.** `git log -1 --format=%H` on `main` after the pull gives the merge SHA. Then `gh run list --branch main --commit <merge-sha> --limit 10` to discover the post-merge runs (typically Vercel production deploy and `e2e.yml` against the production environment).

14. **Post-merge watch on `main` (up to 5 minutes).** Poll the discovered runs via `gh run watch <run-id>`. Expected runs:

    - Vercel production deploy.
    - `e2e.yml` against the production environment (gated on the production `deployment_status` event).

    Outcomes:

    - **All-green within 5 minutes.** Report merge SHA + Vercel production URL + `main: green.`
    - **Red on any check.** Alert immediately with the failing check name, run URL, and a suggested next action (open hotfix branch or revert). The watch reports — it does not auto-act.
    - **Still pending at 5 minutes.** Report what's pending; offer `wait+5`.

## Stash safety

Do not use `git stash && <command>; git stash pop` to switch branches across a dirty tree. `git stash` is a no-op when the tree is already clean — it doesn't push an empty marker — so the trailing `git stash pop` falls through to whatever was already on the stack, potentially applying leftover work from another branch. When step 2's branch-switch precondition fails on a dirty tree, refuse with a manual commit-or-stash suggestion to the human; do not mutate the stash stack on the human's behalf.

## Failure modes

- **No resolvable PR for the argument.** Refuse with a clear next command (e.g., "no open PR for branch X; run `/pr` first").
- **Target branch can't be safely checked out** (dirty working tree on current branch). Refuse with a suggestion to commit or stash; do not auto-stash.
- **`gh` unavailable or unauthenticated.** Refuse loudly.
- **Rebase conflict during freshness update.** Abort the rebase; surface the conflicted files; hand to human.
- **`npm test` fails after rebase.** Refuse; surface the failing test.
- **Any pre-merge check is red, pending past wait limits, or missing where it shouldn't be missing.** Refuse and offer the three supervised-handoff options (`wait+5`, `troubleshoot`, `abort`). No `proceed`.
- **Schema expand required but `npm run prod:db:expand` dispatch fails, maintainer approval is denied, or post-deploy e2e fails.** Refuse; surface the failing run.
- **`gh pr merge` rejected by branch protection or ruleset enforcement.** Surface the protection rule that blocked the merge (e.g., "Branches must be up to date with `main`"). Do not retry blindly.
- **Local branch deletion fails.** Report; do not retry blindly.
- **Post-merge `main` check goes red within the 5-minute watch window.** Alert; suggest hotfix or revert. The watch reports; it does not auto-act.
- **Never** use "Proceed anyway," force-merge, admin bypass, `gh pr merge --auto`, `--squash`, `--merge-title`, or `--body` flags.

## Depends on

- `CLAUDE.md`
- `package.json` (for `npm test`; for `npm run prod:db:expand`)
- `docs/strategy-committing.md` (expand-contract phase rules; AI-trailer subsection)
- `docs/strategy-branching.md` (rebase-when-main-moves rule; merge-commit default)
- `docs/doc-github.md` (PR settings: merge-commit-only; `merge_commit_title`/`merge_commit_message`; `delete_branch_on_merge: true`; `prod-db` environment + required-reviewers gate; docs-only check semantics)
- `docs/strategy-project-management.md` (PR-merged → board "Done" automation)
- `.claude/settings.json` (checked-in `ask` rule on `gh pr merge` — the harness merge confirmation)
- `vercel.json` (`ignoreCommand` for docs-only PRs; `drizzle-kit migrate` ahead of `next build` on production deploys)
- `scripts/update-main-branch-protection.mjs` (required check name `Lint & Functional Tests`; `strict_required_status_checks_policy: true`)
- `.github/workflows/ci.yml` (required check; `dorny/paths-filter` docs-only handling)
- `.github/workflows/e2e.yml` (post-deploy advisory; gated on `deployment_status.environment` ∈ {Preview, Production})
- `.github/workflows/forward-migrate-prod-schema-expansion.yml` (the workflow `/ship` dispatches for expand changes)
- `gh` CLI
- `.claude/skills/pr/SKILL.md` (delegated to on dirty / on-main pre-flight; delegates further to `/commit`)
- `.claude/skills/commit/SKILL.md` (leaf in the delegation chain)
