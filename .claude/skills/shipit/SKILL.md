---

name: shipit
description: "[is-app] Orchestrate the full commit → PR → merge → post-merge-watch chain for a branch or PR in the Intentional Society repo. Invoke explicitly as `/shipit [PR#|URL|issue-or-context]`. Delegates dirty / on-main states to `/pr` (which delegates to `/commit`). Fetches `origin/main`, rebases if needed, dispatches the schema-expand workflow when a schema expand is pending and waits for the `prod-db` approval gate + post-deploy e2e, watches all required and visible advisory pre-merge checks for up to 5 minutes (offering `wait+5` / `troubleshoot` / `abort` — never `proceed anyway`), runs `gh pr merge --merge --delete-branch` (the only valid merge form per repo settings), tidies the local branch, then watches `main` for up to 5 minutes for the production deploy and post-merge e2e. Fires only on explicit `/shipit` invocation."
disable-model-invocation: true
allowed-tools: ["Bash(gh pr merge * --merge --delete-branch)", "PowerShell(gh pr merge * --merge --delete-branch)"]
---

# /shipit

The orchestrator. `/shipit` is the only way to run the chained commit → PR → merge sequence — there is no second path. It delegates downward (`/shipit` → `/pr` → `/commit`) and never auto-acts past the merge: the post-merge watch reports, the human decides whether to hotfix or revert if anything goes red.

## Invocation

`/shipit [PR#|URL|issue-or-context]`

Not `/ship`: that name belongs to Claude Code's bundled `/ship` skill, which commits, opens a PR and watches it but never merges. If the human typed `/ship` expecting this skill, tell them to type `/shipit`.

Argument resolution: same order as `/pr` (PR URL → `gh pr view <N>` → `gh issue view <N>` → plain-language context).

**Branch-switching policy.** If `[PR#|URL]` resolves to a PR on a branch different from the current checkout, `/shipit` **may** switch branches — but only after verifying the current branch's working tree is clean. If the tree is dirty, refuse with a suggestion to commit or stash; never auto-stash (see Stash safety below). `/pr` refuses to switch under all conditions; `/shipit` is the only Skill that switches.

**No `--squash` flag.** Repo PR settings disable squash and rebase merging — only merge-commit is allowed. The merge command is always `gh pr merge --merge --delete-branch`. Re-enabling squash is a repo-policy decision, not a Skill flag.

Natural-language phrasings ("ship it", "merge this PR") are guidance, not triggers. With `disable-model-invocation: true`, this Skill fires only on explicit `/shipit`.

## Steps

1. **Check `gh` auth.** `gh auth status`. If it fails, refuse and print `gh auth login`.

2. **Parse arguments; resolve target PR.** If the argument names a different branch AND the current working tree is clean, `git switch <target-branch>`. If the current working tree is dirty, refuse with a clear suggestion (commit or stash). Do not auto-stash.

3. **Working-tree pre-flight.** If dirty or on `main` with no PR for the current branch, delegate to `/pr` (which delegates to `/commit` per `/pr` step 4). **Immediately before invoking `/pr`, write the delegation marker `.claude/.nl-delegation-active` as `ship\t<current ISO-8601 UTC>`** so the delegated `/pr` (and, in turn, `/commit`) doesn't re-prompt for natural-language intent the human already gave by typing `/shipit`. **As you write the marker and invoke `/pr`, print `Using /pr — delegated from /shipit` as the first line** so the delegation cascade is visible; `/pr` suppresses its own announcement (marker present) and in turn narrates `Using /commit — delegated from /pr` when it delegates onward. Each skill consumes the marker on read at its Step 0 (honoring it only if <30s old) and re-writes a fresh one before its own downstream delegation; **after `/pr` returns, delete the marker if it still exists** (cleanup). When `/pr` returns with a PR URL, continue.

4. **Fetch — no shallow shortcuts.** `git fetch origin main`. Do not use shallow-fetch shortcuts (`--depth=1` etc.) for freshness checks — a shallow fetch breaks `git merge-base` and was the root cause of a recent expand-workflow bug ([PR #254](https://github.com/Intentional-Society/is-app/pull/254)).

   **Capture the last-push cutoff now, before any rebase:** `gh pr view <N> --json commits --jq '.commits[-1].committedDate'`. Step 10 compares the conversation against this value. A rebase in steps 5–6 rewrites the head commit and its committer date, so a cutoff taken after it would sit later than the real push and hide every comment posted in between (PR #587, 2026-09-23: two comments fell into that gap). If this run opened the PR itself (step 3), the cutoff is the push `/pr` just made.

5. **Freshness check + rebase if needed.** Run `git merge-base --is-ancestor origin/main HEAD`. If it fails (main has moved), `git rebase origin/main`. On rebase conflict, abort and surface — do not auto-resolve.

6. **Re-gate after rebase.** If the rebase changed anything, re-run `npm test`, then `git push --force-with-lease`. A docs-only branch (`node scripts/docs-only.mjs origin/main` exits 0; `AGENTS.md` → Workflow) skips `npm test` and runs `/pr` step 7's lighter check before the push: `git diff --check origin/main HEAD` shows no leftover conflict markers, `git diff --stat origin/main HEAD` shows only the intended change, and paths the changed lines reference still exist.

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

   Once green, record the head commit the checks ran on (`gh pr view <N> --json headRefOid`); step 11's head-moved check compares against it.

9. **Docs-only PR handling.** If the PR is docs-only (`node scripts/docs-only.mjs origin/main` exits 0):
   - `ci.yml`'s `dorny/paths-filter` step skips the test steps but still posts `Lint & Functional Tests` green within seconds (satisfies branch protection).
   - Vercel preview is skipped per `vercel.json`'s `ignoreCommand`, so no preview `deployment_status` event fires and preview `e2e.yml` does not run.
   - Treat the absent pre-merge advisory checks (E2E, anything else gated on the preview deploy) as **expected** per `docs/doc-github.md`'s docs-only rule. Proceed on required-green only — do not wait for advisories that the docs-only path skipped by design.

10. **Read the PR conversation — right before the merge.** Run this after CI is green and after any wait above, immediately before the merge: review bots post several minutes after a push (17 minutes on PR #578), so a read taken the moment CI turns green can miss one. If anything else is waited on after this read, read again.

    Read every source — a bot can post a plain top-level comment rather than a review, so reading reviews alone misses it:
    - **Last push time:** the cutoff captured at step 4, before any rebase — not a fresh read of the head commit's date, which a rebase moves forward. GitHub does not expose when an ordinary push happened; the pre-rebase head commit's committer date is never later than its push, so using it can only list extra items, never hide one.
    - **Top-level comments and reviews:** `gh pr view <N> --json comments,reviews` (`comments[].createdAt`; `reviews[].submittedAt`, `.state`, `.body`).
    - **Poster identity for top-level comments:** `gh api --paginate repos/<owner>/<repo>/issues/<N>/comments` (`user.login`, `user.type`, `performed_via_github_app.slug`, `body`, `created_at`). `gh pr view` drops the `[bot]` suffix from logins, so this REST read is the only place the account type and the posting app are visible; match it to the `gh pr view` comments by `created_at` and body.
    - **Inline review comments:** `gh api --paginate repos/<owner>/<repo>/pulls/<N>/comments` (`created_at`, `path`).
    - **Review threads' resolved state:** `gh api graphql -F owner=<owner> -F repo=<repo> -F n=<N> -f query='query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved path comments(first:1){nodes{author{login} createdAt body}}}}}}}'`. The REST API has no resolved flag; GraphQL's `reviewThreads.isResolved` is the only place `gh` exposes it.

    **Unanswered** (the maintainer's definition, recorded on #580) means:
    - any top-level comment, review or inline comment posted after the last push — by anyone, **including the PR's author and the account running `/shipit`**, because agent sessions post under the maintainer's account, so authorship shows nothing;
    - plus every inline review thread with `isResolved: false`, however old;
    - except an approval with no text (`state: APPROVED`, empty `body`), which never counts. Every other review counts, even one with an empty body.
    - except three automated posts that never carry anything a human must answer (#601), each keyed on the poster's account type and posting app, never on a display name or wording alone:
      - a **deployment card** — `user.type: Bot`, posted via the `vercel` app, body beginning `[vc]:`;
      - the **automated review's own comment** — posted via the `github-actions` app, first line `## Claude review` (`claude-code-review.yml`, #680). Its summary never counts: the review posts each finding as an inline comment, and those **count and stop the merge** under the rules above. Its "did not finish" notice counts, because the latest push went unreviewed, unless it says a newer push superseded it;
      - **`/pr`'s own new-commits note** — first line exactly `_/pr: new commits since the PR body was written_`, posted by the account running this ship (`gh api user --jq .login`). Any other comment by that account still counts.
        A new bot gets its own explicit line here; never a wildcard on `[bot]`.

    List each item once, even when it matches both rules. If nothing is unanswered, print `Conversation: nothing unanswered since the last push (<time>).` and continue. Otherwise list each item — author, time (UTC), first line of its text (`(no text)` if empty), and the file for inline items — then **STOP** and ask `N unanswered since the last push — merge anyway?`. Continue to the merge only on an explicit yes; any other reply ends the run without merging, with the PR URL surfaced. If any read above fails, or `hasNextPage` is true, the conversation is not proven clear: say which read failed and ask the same question. Never treat a failed read as nothing unanswered.

    This stop is about the conversation, not the merge command, and fires only when something is unanswered or unread. An explicit yes here is the human's decision on those items; it is not a step 11 doubt.

11. **Merge authorization.** Three pieces decide whether the merge asks a human:
    - **This skill's `allowed-tools`** grants exactly `gh pr merge <N> --merge --delete-branch`, and Claude Code applies that grant only during the turn the human typed `/shipit`. Claude Code checks each part of a compound command itself, so anything chained onto the merge still needs its own permission.
    - **The merge gate**, a PreToolUse hook (`.claude/hooks/ship-merge-gate.mjs`, registered in `.claude/settings.json`), asks for every `gh pr merge` unless this machine has the opt-out file `.claude/skip-merge-confirm.local`, the last message the human typed is `/shipit`, **and** the merge command's description starts with `Looks safe to me`. It never allows anything itself.
    - **Checked-in `ask` rules** in `.claude/settings.json` ask for any merge with `--admin`, `--auto`, or another repository (`-R`, `--repo`).

    So on an opted-out machine, typing `/shipit` is the merge approval whenever you can honestly say the merge looks safe. Otherwise the gate's prompt is the question, and the description you write is what the human reads in it.

    **Doubt checks.** Run every check, opted out or not. Each hit is a doubt:
    - **Someone else's PR.** The PR author (`gh pr view <N> --json author`) is not the account running `/shipit` (`gh api user --jq .login`).
    - **Changes requested.** The PR's `reviewDecision` is `CHANGES_REQUESTED`.
    - **Production database.** The PR adds or changes files under `drizzle/` or changes `src/server/schema.ts` (the production deploy runs `drizzle-kit migrate`), or this run dispatched a schema expand at step 7. Read the changed files from `git diff --name-only origin/main...HEAD` (local, and the same in a sandbox).
    - **Head moved.** The PR's head commit (`gh pr view <N> --json headRefOid`) differs from the commit whose checks went green at step 8, or from the local `git rev-parse HEAD`. The second case means the local branch isn't what will merge (someone pushed to the PR on GitHub), so the local diff the production-database check reads can't be trusted.
    - **`main` is red.** The latest production deploy or `e2e.yml` run on `main` failed, so the merge would land on a broken production.
    - **Inferred target.** The PR was resolved from an issue number or plain-language context, not from a PR number, a PR URL, or the current branch's own PR.
    - **Anything else.** Anything about this run that makes you want a human to look before the merge, even if it fits none of the checks above and you can't pin it down, such as a diff carrying changes unrelated to the PR's title. Asking costs the human one click, so when in doubt, ask. Say what gave you pause.

    **Say it in the merge command's description** (step 12):
    - **No doubt:** start the description with `Looks safe to me.`, then the narration line. That sentence is what lets the gate stay silent, so write it only when every check above passed; it is a statement to the human, not a formality.
    - **Any doubt:** start the description with one `Asking for merge confirmation: <what> — <why>` line per doubt, in plain words (for example `Asking for merge confirmation: someone else's PR — PR 227 is by benjifriedman, not NorsemanSpiff`), then the narration line. The gate prompts, and Claude Code shows the description above the command in the approval dialog.

    Never create `.claude/skip-merge-confirm.local` unless the human asks for it. Standard opt-out file contents: `Lets /shipit merge without the merge-gate prompt when its doubt checks pass. Merges outside /shipit still prompt. Delete this file to re-enable.`

12. **Merge.** First print the **required pre-merge narration** — one line with PR number, title, and check posture (e.g. `Merging PR #123 "Add dark mode" — required green (Lint & Functional ✓); advisories: E2E ✓.`) — then run `gh pr merge <N> --merge --delete-branch` with the description step 11 says to write: `Looks safe to me.` or the doubt lines, then the narration line.
    - **Run exactly `gh pr merge <N> --merge --delete-branch`, as its own command, with nothing appended** (no `2>&1`, no `; echo …`). This skill's `allowed-tools` grant covers only that form; anything else falls outside it and prompts.
    - **The grant lasts one turn.** A reply the human types (for example to step 10's "merge anyway?") starts a new turn, so the merge after it prompts. That is expected; it is not an error to work around.
    - Never widen this skill's `allowed-tools`, and never set `disableAllHooks`.
    - Do **not** pass `--merge-title` or `--body` flags. GitHub uses the PR title and body verbatim per the repo's `merge_commit_title: PR_TITLE` / `merge_commit_message: PR_BODY` settings; custom flags would override that and create inconsistent history.
    - Never `--admin`, `--auto`, force-merge, `--squash` (repo-disabled), or any branch-protection bypass.

13. **Tidy.** `git switch main && git pull --ff-only`. Then `git branch -d <feature-branch>` if the local branch still exists and is fully merged. The remote branch is auto-deleted on merge (`delete_branch_on_merge: true`); the explicit `--delete-branch` flag on `gh pr merge` covers both the local-cleanup intent and the rare case where remote deletion didn't happen.

14. **Capture merge SHA + discover post-merge runs.** `git log -1 --format=%H` on `main` after the pull gives the merge SHA. Then `gh run list --branch main --commit <merge-sha> --limit 10` to discover the post-merge runs (typically Vercel production deploy and `e2e.yml` against the production environment).

15. **Post-merge watch on `main` (up to 5 minutes).** Poll the discovered runs via `gh run watch <run-id>`. Expected runs:
    - Vercel production deploy.
    - `e2e.yml` against the production environment (gated on the production `deployment_status` event).

    After a docs-only merge (step 9's condition), `ignoreCommand` usually skips the production build, so Vercel reports the commit as canceled and no production `e2e.yml` runs. Treat both as expected: watch whatever else ran (e.g. CodeQL) and report `main: green (production deploy skipped, docs-only).` The build still runs when production is behind `main` (an earlier code merge's production build failed or hadn't finished), because `ignoreCommand` compares against the last successful production deploy; then watch the deploy and production `e2e.yml` as usual.

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
- **`npm test` fails after rebase, or a docs-only branch fails step 6's lighter check.** Refuse; surface the failing output.
- **Any pre-merge check is red, pending past wait limits, or missing where it shouldn't be missing.** Refuse and offer the three supervised-handoff options (`wait+5`, `troubleshoot`, `abort`). No `proceed`.
- **Schema expand required but `npm run prod:db:expand` dispatch fails, maintainer approval is denied, or post-deploy e2e fails.** Refuse; surface the failing run.
- **Unanswered PR conversation since the last push, or a conversation read that failed (step 10).** List the items (or the failed read) and ask `N unanswered since the last push — merge anyway?`; merge only on an explicit yes.
- **A doubt check hits (step 11).** Put each doubt, in plain words, at the start of the merge command's description instead of `Looks safe to me.`; the gate prompts and shows it.
- **The merge prompts or is denied.** Report it with the reason shown and stop; do not rewrite the command to get past it.
- **`gh pr merge` rejected by branch protection or ruleset enforcement.** Surface the protection rule that blocked the merge (e.g., "Branches must be up to date with `main`"). Do not retry blindly.
- **Local branch deletion fails.** Report; do not retry blindly.
- **Post-merge `main` check goes red within the 5-minute watch window.** Alert; suggest hotfix or revert. The watch reports; it does not auto-act.
- **Never** use "Proceed anyway," force-merge, admin bypass, `gh pr merge --auto`, `--squash`, `--merge-title`, or `--body` flags.

## Depends on

- `AGENTS.md`
- `CLAUDE.md`
- `package.json` (for `npm test`; for `npm run prod:db:expand`)
- `scripts/docs-only.mjs` (the docs-only definition steps 6 and 9 check)
- `docs/strategy-committing.md` (expand-contract phase rules; AI-trailer subsection)
- `docs/strategy-branching.md` (rebase-when-main-moves rule; merge-commit default)
- `docs/doc-github.md` (PR settings: merge-commit-only; `merge_commit_title`/`merge_commit_message`; `delete_branch_on_merge: true`; `prod-db` environment + required-reviewers gate; docs-only check semantics)
- `docs/strategy-project-management.md` (PR-merged → board "Done" automation)
- `.claude/settings.json` and `.claude/hooks/ship-merge-gate.mjs` (the merge gate and the `--admin`/`--auto`/`-R`/`--repo` ask rules; step 11 says how they combine with this skill's `allowed-tools`)
- `vercel.json` (`ignoreCommand` → `scripts/vercel-ignore-build.mjs` for docs-only PRs and docs-only merges to `main`; `drizzle-kit migrate` ahead of `next build` on production deploys)
- `scripts/update-main-branch-protection.mjs` (required check name `Lint & Functional Tests`; `strict_required_status_checks_policy: true`)
- `.github/workflows/ci.yml` (required check; `dorny/paths-filter` docs-only handling)
- `.github/workflows/e2e.yml` (post-deploy advisory; gated on `deployment_status.environment` ∈ {Preview, Production})
- `.github/workflows/forward-migrate-prod-schema-expansion.yml` (the workflow `/shipit` dispatches for expand changes)
- `gh` CLI (including `gh api` REST — `issues/<N>/comments` for poster identity, `pulls/<N>/comments` — and `gh api graphql` for step 10's conversation read)
- Issue #580 (the maintainer's definition of "unanswered" that step 10 implements), #601 (its three automated-post exclusions) and #680 (the automated review's comments)
- `.claude/skills/pr/SKILL.md` (delegated to on dirty / on-main pre-flight; delegates further to `/commit`)
- `.claude/skills/commit/SKILL.md` (leaf in the delegation chain)
