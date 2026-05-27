---
name: pr
description: Open a new PR or update an existing PR for the current branch in the Intentional Society repo. Invoke explicitly as `/pr [PR#|URL|issue-or-context]`. Always fetches `origin/main` first, rebases if main has moved (re-running `npm test` after rebase), then pushes. On a fresh branch with no open PR, drafts a Conventional Commit-style title and structured body for human approval before `gh pr create`. On an existing PR, posts a brief per-commit summary comment and only updates the PR body on material scope change (with human approval, because the body becomes the merge commit message). Delegates dirty / on-main states to `/commit`. Refuses branch-switching — that's `/ship`'s job. Does not poll CI checks. Fires only on explicit `/pr` invocation.
disable-model-invocation: true
---

# /pr

The middle Skill in the commit → PR → ship chain. `/pr` ensures the branch is current with `origin/main`, runs `npm test` again if anything changed during rebase, and either opens a new PR or summarizes new commits on the existing one. It does **not** watch CI and it does **not** merge — that's `/ship`'s job.

## Invocation

`/pr [PR#|URL|issue-or-context]`

Argument resolution order:

1. **URL parses as a PR URL** → existing PR.
2. **Integer resolves via `gh pr view <N>`** → existing PR.
3. **Integer resolves via `gh issue view <N>`** → issue context (treated the same as `/commit`'s issue-or-context — used for branch naming, PR-title hints, and `Closes #N` linking).
4. **Anything else** → plain-language context.

No `/pr --auto-ship` and no `/pr --auto-merge`. `/ship` is the chained workflow; `/pr` stops after opening or updating the PR.

Natural-language phrasings ("open the PR for this branch", "make a PR") are guidance, not triggers. With `disable-model-invocation: true`, this Skill fires only on explicit `/pr`.

## Steps

1. **Check `gh` auth.** `gh auth status`. If it fails, refuse and print `gh auth login` as the suggested next command.

2. **Resolve the argument** using the order above.

3. **Refuse to switch branches.** If the resolved PR is on a branch different from the current checkout, refuse — `/pr` does not switch branches. Name both branches and suggest `/ship <PR#>` (which is allowed to switch when the working tree is clean).

4. **Working-tree pre-flight.** If `git status --porcelain` is non-empty OR HEAD is `main`, delegate to `/commit` with the same argument. When `/commit` returns, continue with this Skill from step 5.

5. **Fetch.** `git fetch origin main`.

6. **Freshness check + rebase if needed.** Run `git merge-base --is-ancestor origin/main HEAD`. If it fails (main has moved relative to the branch), run `git rebase origin/main`. On rebase conflict, abort the rebase, report the conflicted files, and hand control to the human — don't try to resolve conflicts automatically.

7. **Re-run the gate after rebase.** If the rebase changed anything, re-run `npm test`. Skip the re-run when the rebase was a no-op.

8. **Push.** `git push -u origin <branch>`. Use `--force-with-lease` only if the rebase rewrote already-pushed commits. Never plain `--force`.

9. **If no open PR for this branch — draft and create.**

    Draft a PR title and body for human approval, then run `gh pr create`.

    **Title:** same Conventional Commit-style headline rule as `/commit`. `<type>[(scope)]: <imperative summary>`, ≤70 chars, including `!` for breaking changes. The title is durable: GitHub uses it verbatim as the merge commit subject (`merge_commit_title: PR_TITLE`).

    **Body:** the same structured convention as `/commit`'s message body.

    - `Summary:` — one sentence.
    - `Why:` — motivation.
    - `Behavior:` — observable change.
    - `Test Plan:` — evidence (commands run with output, human attestations, or the collapsed `ran \`npm test\` locally` line). Same provenance rule as `/commit` — never invented.
    - `Closes #N` / `(#N)` references.
    - AI co-author trailer (same protocol as `/commit`: canonical form when detection succeeds, ask-once + body caveat on fallback).

    **Test-plan formatting.** Plain bullets, not Markdown task-list checkboxes. The body becomes the durable merge commit message in this repo (`merge_commit_message: PR_BODY`), and unchecked task-list boxes look like outstanding work. If human-only verification remains, surface it as a pending action or reviewer note, not as completed test evidence. Don't add task-list checkboxes unless they already come from `.github/PULL_REQUEST_TEMPLATE.md`.

    Present the full draft (title + body) for human Y/n approval before `gh pr create`. On approval, run `gh pr create`.

10. **If an open PR for this branch exists — comment-by-default, body-update only on material scope change.**

    Post a short PR-conversation comment summarizing each new commit pushed in this run (one bullet per commit; subject + short rationale).

    Update the PR body **only** if the new commits materially change the PR's scope. Because the body is the durable merge commit message, ask for human approval before saving any body update. Phrase the question concretely — show the proposed diff to the body, not just "want me to update?"

11. **Print the PR URL and stop.** `/pr` does not poll CI checks. Watching CI and merging is `/ship`'s job.

## Failure modes

- **`gh` unavailable or unauthenticated.** Refuse loudly; print `gh auth login`.
- **Argument resolves to a PR on a different branch from the current checkout.** Refuse; name both branches; suggest `/ship <PR#>` for switching.
- **Rebase conflict during `git rebase origin/main`.** Abort the rebase; report conflicted files; hand to human. Do not auto-resolve.
- **`npm test` fails after rebase.** Refuse; surface the failing test output.
- **`gh pr create` fails or the PR-comment update fails.** Report the error; do not retry blindly.
- **Human rejects the PR draft text or the body-update proposal.** Return to step 9 or 10 with the rejection reason captured.
- **Duplicate PR would result** (an open PR already exists for the branch and the argument asked to create another). Refuse.
- **Never enable GitHub-side auto-merge.** `allow_auto_merge` is off at the repo level; do not work around it.
- **Never silently force-push.** Use `--force-with-lease` and only when the rebase actually rewrote already-pushed commits.

## Depends on

- `CLAUDE.md`
- `package.json` (for `npm test`)
- `docs/strategy-committing.md` (commit/PR format, AI-trailer subsection)
- `docs/strategy-branching.md` (rebase-when-main-moves rule; up-to-date branch protection)
- `docs/doc-github.md` (PR settings: merge-commit-only; `merge_commit_title: PR_TITLE`; `merge_commit_message: PR_BODY`; `allow_update_branch: true` but local rebase preferred so the post-update `npm test` gate can re-run)
- `docs/strategy-project-management.md` (PR-linked → board "In progress" automation)
- `.github/workflows/ci.yml` (the required check that gates merge)
- `gh` CLI
- `.claude/skills/commit/SKILL.md` (delegated to on dirty / on-main pre-flight)
