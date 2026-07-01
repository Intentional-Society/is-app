---
name: pr
description: "[is-app] Open or update the PR for the current branch: fetch + rebase on main, re-test if rebased, drafted title/body with human approval. Delegates uncommitted changes to /commit; never switches branches or merges. Use for any PR intent — \"open a PR for this\", or `/pr #142`. Announce `Using /pr` as you route, before the Skill call."
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

**Invocation paths.** This Skill fires on an explicit `/pr` **and** on natural-language PR intent ("open a PR for this branch", "make a PR") — **including when *you* offered to open a PR and the human merely affirms** ("yes", "go ahead", "do it"). That affirmation is the trigger: route it through this Skill via the `Skill` tool — never hand-roll the PR with ad-hoc `git`/`gh` commands. Scope it to your own PR offer: a bare "yes" to an *unrelated* offer (a refactor, rename, or search) is **not** a PR trigger — don't fire `/pr` on it. On **every** model-invoked (natural-language) run, **announce `Using /pr` as you route — the first line of the message in which you call the `Skill` tool, before the call** so the human can see the Skill fired (a delegated call is the exception — the parent announces the handoff; see Step 0). On the natural-language path the model-invoked **Step 0** also confirms intent first (see Steps); explicit `/pr` and delegated calls (`/ship` → `/pr`) skip the *confirmation*, but the announcement still applies to any model-invoked run.

## Steps

0. **Announce + NL intent gate (model-invoked only).**

   **Announcement — at the routing decision; backstop here.** You should already have announced `Using /pr` as you routed — the first line of the message in which you invoked the `Skill` tool, before the call (see CLAUDE.md / Invocation paths). **If you have not, announce it now as the first visible line of your response** — exactly once, never doubled. **Exception — delegated calls:** when the delegation marker (below) is present (a parent `/ship` set it), do **not** announce — the parent already printed `Using /pr — delegated from /ship` on your behalf. The opt-out file does **not** suppress the announcement (it suppresses only the *confirmation* below); only delegation does. The announcement is the forcing function that keeps this flow inside the Skill — an ad-hoc `gh pr create` can't honestly print it.

   **Intent gate.** Fire this gate only when this Skill was invoked via the `Skill` tool **and none** of the following holds; otherwise go straight to step 1:

   - **Verified slash entry** — a `<command-name>` tag for `/pr` is present in the turn (heuristic; if that signal isn't reliably visible, bias toward *firing* the gate).
   - **Live delegation marker** — `.claude/.nl-delegation-active` exists (a parent `/ship` wrote it as `<parent-skill>\t<ISO-8601 UTC>` immediately before delegating here). If it exists **and its timestamp is within the last 30s**: **delete it (clear-on-read) and proceed to step 1**. If it exists but is **older than 30s** (a stale leftover from an interrupted run): delete it and **continue this gate** (treat as a standalone invocation). The 30s lease — plus the parent deleting the marker after the delegated call returns — keeps a crashed delegation from silently suppressing Step 0 later.
   - **Opt-out file** — `.claude/skip-nl-confirm-commit-pr.local` exists.

   When the gate fires, **before any other action** (no `gh auth`, no git/`gh` commands), present via `AskUserQuestion`: "Open a PR with: *[detected context — echo any user guidance]*?" with options **Proceed** / **Proceed and don't ask again** (creates `.claude/skip-nl-confirm-commit-pr.local` with the standard note) / **Stop** (zero side effects). The standard note text and the intent-vs-content rationale are identical to `/commit`'s Step 0. If you change this gate, re-run the verification checklist in `docs/plan-skill-nl-invocation.md`.

1. **Check `gh` auth.** `gh auth status`. If it fails, refuse and print `gh auth login` as the suggested next command.

2. **Resolve the argument** using the order above.

3. **Refuse to switch branches.** If the resolved PR is on a branch different from the current checkout, refuse — `/pr` does not switch branches. Name both branches and suggest `/ship <PR#>` (which is allowed to switch when the working tree is clean).

4. **Working-tree pre-flight.** If `git status --porcelain` is non-empty OR HEAD is `main`, delegate to `/commit` with the same argument. **Immediately before invoking `/commit`, write the delegation marker `.claude/.nl-delegation-active` as `pr\t<current ISO-8601 UTC>`** so `/commit`'s Step 0 doesn't re-prompt for intent the human already gave to `/pr`. **As you write the marker and invoke `/commit`, print `Using /commit — delegated from /pr` as the first line** so the delegated Skill is visible in the cascade; `/commit` suppresses its own announcement because the marker is present. `/commit` consumes it on read; **after `/commit` returns, delete the marker if it still exists** (belt-and-suspenders cleanup so a crashed delegation can't leave it behind). When `/commit` returns, continue with this Skill from step 5.

5. **Fetch.** `git fetch origin main`.

6. **Freshness check + rebase if needed.** Run `git merge-base --is-ancestor origin/main HEAD`. If it fails (main has moved relative to the branch), run `git rebase origin/main`. On rebase conflict, abort the rebase, report the conflicted files, and hand control to the human — don't try to resolve conflicts automatically.

7. **Re-run the gate after rebase.** If the rebase changed anything, re-run `npm test`. Skip the re-run when the rebase was a no-op.

8. **Push.** `git push -u origin <branch>`. Use `--force-with-lease` only if the rebase rewrote already-pushed commits. Never plain `--force`.

9. **If no open PR for this branch — draft and create.**

    Draft a PR title, body, and reviewer list for human approval, then run `gh pr create` (always assigning the PR to its opener — see **Assignee** below).

    **Title:** same Conventional Commit-style headline rule as `/commit`. `<type>[(scope)]: <imperative summary>`, ≤70 chars, including `!` for breaking changes. The title is durable: GitHub uses it verbatim as the merge commit subject (`merge_commit_title: PR_TITLE`).

    **Body:** the same structured convention as `/commit`'s message body.

    - `Summary:` — one sentence.
    - `Why:` — motivation.
    - `Behavior:` — observable change.
    - `Test Plan:` — evidence (commands run with output, human attestations, or the collapsed `ran \`npm test\` locally` line). Same provenance rule as `/commit` — never invented.
    - `Closes #N` / `(#N)` references.
    - AI co-author trailer (same protocol as `/commit`: canonical form when detection succeeds, ask-once + body caveat on fallback).

    **Test-plan formatting.** Plain bullets, not Markdown task-list checkboxes. The body becomes the durable merge commit message in this repo (`merge_commit_message: PR_BODY`), and unchecked task-list boxes look like outstanding work. If human-only verification remains, surface it as a pending action or reviewer note, not as completed test evidence. Don't add task-list checkboxes unless they already come from `.github/PULL_REQUEST_TEMPLATE.md`.

    **Reviewers — show a one-line picker so the human picks correct logins without spelling them.** The bundled approval block has a third item alongside title and body: a `Reviewers:` picker built from a cached team list. Humans often think in real names ("add Blake") but GitHub needs the login (`NorsemanSpiff`); surfacing the team list eliminates name-to-handle guessing AND catches stale handles (e.g., `alexisChen9090` is a frozen historical handle for `AlexisChen99`).

    **Team cache.** Store at `.claude/skills/pr/.team-cache.json` (per-machine, gitignored):

    ```json
    {
      "collaborators": ["<login>", ...],
      "displayNames": { "<login>": "<name or login>", ... },
      "self": "<your login>",
      "refreshedAt": "<ISO timestamp>"
    }
    ```

    Populate on cold cache. Steps (1) and (2) run in parallel; step (3) fans out per-login after (1) returns and the bot filter is applied:

    1. `gh api 'repos/<owner>/<repo>/collaborators' --paginate --jq '.[].login'` — full collaborator list.
    2. `gh api user --jq '.login'` — the running human's login (stored as `self`).
    3. For each surviving login, `gh api users/<login> --jq '.name // .login'` in parallel — display names. `// .login` returns the login when `.name` is null.

    Apply the **bot filter** to (1) before writing the cache: drop `github-advanced-security`, `copilot-pull-request-reviewer`, `claude`, any login starting with `app/`, any login containing `[bot]`. Maintain the list here in the SKILL.md as GitHub adds new advisory bots over time.

    <!-- TODO(PR#305-followup): bot filter is applied at cache-write time, so existing teammate caches don't auto-invalidate when this list changes. Self-heals on the next `gh pr create --reviewer` rejection via the refresh-on-rejection path — at the cost of one wasted prompt cycle. Worth an explicit "force-refresh on filter version bump" if that cycle ever matters in practice. -->

    **Refresh triggers** (any one):
    - `refreshedAt` is older than **15 days**.
    - `gh pr create --reviewer <list>` rejects a login that exists in the cache (signal: a teammate was removed).
    - The human types `refresh` in the reviewer prompt (escape hatch for "new teammate joined, refresh now").

    **Render the picker.** Exclude `self` at render time so the same cache works for any teammate running `/pr`. Sort the remaining collaborators alphabetically by display name, case-insensitive. Number them in sort order. Render every collaborator — no truncation:

    ```text
    Reviewers? Reply with names, logins, numbers, "all", or blank:
      [1] AlexisChen99    (AlexisChen)
      [2] benjifriedman   (Benji Friedman)
      [3] Ceantaur        (Sean)
      [4] james-baker     (James Baker)
      [5] oolu4236        (OLA)
    ```

    **Accept the human's reply** in any of these shapes and resolve to a list of GitHub logins:

    - Numbers (`1 3`, `1,3`, `1, 3`) — positional pick from the rendered order. If any number is out of range (e.g., `7` when only 5 entries are rendered), surface the invalid index and re-ask rather than partial-resolve.
    - Display names or partial names (`james and benji`, `Alexis`) — match against the cached display-name dictionary. On ambiguity, ask one clarifying question rather than guess.
    - Exact logins (`james-baker, benjifriedman`) — passed through after validating against the cache.
    - `all` / `everyone` / `whole team` — every collaborator except `self`. If the resulting set is empty (one-person repo where `self` is the only collaborator), treat as `none`.
    - `none` / blank / `skip` — no reviewers.
    - `refresh` — refresh the team cache and re-render the picker.

    **Echo the resolution** as one line before `gh pr create`, so the human always sees what got resolved:

    ```text
    → Assigning to <self>; requesting review from james-baker, benjifriedman. Proceeding.
    ```

    Pass the resolved list to `gh pr create --reviewer <login1>,<login2>,... --assignee @me` (no `@` prefix on reviewer logins, no spaces inside the `--reviewer` value); omit `--reviewer` when the list is empty, but **always keep `--assignee @me`**.

    **Assignee — always assign the PR to its opener (you).** `gh pr create` leaves the Assignees field empty by default, so PRs end up owned by no one — the gap this fixes. Always pass `--assignee @me`; it resolves to the authenticated `gh` user running `/pr` (= `self` in the team cache) without a lookup. Unconditional, no picker needed: the opener is the person driving the PR (addressing review, shipping it). Distinct from reviewers — the reviewer list may be empty, the assignee never is. (If `/pr` runs on a branch authored by someone else, the executor is still the assignee: they're driving it now; the commit author field records original authorship.)

    **Failure handling.**

    - If the cache file is missing or unreadable, regenerate it via the cold-cache path above. If regeneration fails (network, rate limit, gh unauthenticated), fall back to a bare `Reviewers (comma-separated logins or blank):` prompt with no picker — the Skill still works, just less ergonomically.
    - If `gh pr create --reviewer` rejects a login (typo, no longer a collaborator), refresh the cache, surface the exact `gh` error + the refreshed picker, and re-ask. Don't retry blindly.

    Present the full draft (title + body + reviewers) for human Y/n approval before `gh pr create`. On approval, run `gh pr create` with `--assignee @me` always, plus `--reviewer` when the reviewer list is non-empty.

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
