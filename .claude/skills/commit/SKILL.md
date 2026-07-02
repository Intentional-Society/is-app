---
name: commit
description: "[is-app] Stage, commit, and push the current changes via the team's guarded workflow: local `npm test` gate, suspicious-file checks, one bundled human approval, auto-branch from main. Use for any commit/push intent — \"commit this\", \"commit in two steps: X then Y\", or `/commit #142`. Announce `Using /commit` as you route, before the Skill call."
---

# /commit

The leaf Skill in the commit → PR → ship chain. `/commit` is the only place changes leave the working tree; both `/pr` and `/ship` delegate here when the tree is dirty or HEAD is `main`.

## Invocation

`/commit [issue-or-context]`

| Argument shape | Interpretation |
|---|---|
| *(none)* | Infer context from branch name and diff. |
| `#<N>` or bare `<N>` | Treat as a GitHub issue number; resolve with `gh issue view <N>`. |
| Any other text | Use as plain-language context for branch naming, issue-lookup hints, and commit-message draft. |

Cache the argument for `/pr` and `/ship` in this session so chained invocations reuse the same context.

**Invocation paths.** This Skill fires on an explicit `/commit` **and** on natural-language commit intent ("commit this", "commit these changes in two commits: X then Y") — **including when *you* offered to commit and the human merely affirms** ("yes", "go ahead", "do it"). That affirmation is the trigger: route it through this Skill via the `Skill` tool — never hand-roll the commit with ad-hoc `git` commands. Scope it to your own commit offer: a bare "yes" to an *unrelated* offer (a refactor, rename, or search) is **not** a commit trigger — don't fire `/commit` on it. On **every** model-invoked (natural-language) run, **announce `Using /commit` as you route — the first line of the message in which you call the `Skill` tool, before the call** so the human can see the Skill fired (a delegated call is the exception — the parent announces the handoff; see Step 0). On the natural-language path the model-invoked **Step 0** also confirms intent first (see Steps); explicit `/commit` and delegated calls skip the *confirmation*, but the announcement still applies to any model-invoked run.

## Steps

Run these in order. Each step's failure mode is in the Failure modes section below.

0. **Announce + NL intent gate (model-invoked only).**

   **Announcement — at the routing decision; backstop here.** You should already have announced `Using /commit` as you routed — the first line of the message in which you invoked the `Skill` tool, before the call (see CLAUDE.md / Invocation paths). **If you have not, announce it now as the first visible line of your response** — exactly once, never doubled. **Exception — delegated calls:** when the delegation marker (below) is present **and fresh** (its timestamp within the last 30s — the same lease the intent gate applies below), do **not** announce; the parent already printed `Using /commit — delegated from /pr` on your behalf. A **stale** marker (older than 30s, e.g. from a crashed delegation) is *not* a delegated call — announce as normal (the gate deletes it and treats this as a standalone run). The opt-out file does **not** suppress the announcement (it suppresses only the *confirmation* below); only delegation does. The announcement is the forcing function that keeps this flow inside the Skill — an ad-hoc `git commit` can't honestly print it.

   **Intent gate.** Fire this gate only when this Skill was invoked via the `Skill` tool **and none** of the following holds; otherwise go straight to step 1:

   - **Verified slash entry** — a `<command-name>` tag for `/commit` is present in the turn (heuristic; if that signal isn't reliably visible, bias toward *firing* the gate — a redundant confirm is harmless, a missed one isn't).
   - **Live delegation marker** — `.claude/.nl-delegation-active` exists (a parent `/pr` or `/ship` wrote it as `<parent-skill>\t<ISO-8601 UTC>` immediately before delegating here). If it exists **and its timestamp is within the last 30s**: **delete it (clear-on-read) and proceed to step 1**. If it exists but is **older than 30s** (a stale leftover from an interrupted run): delete it and **continue this gate** (treat as a standalone invocation). The 30s lease — plus the parent deleting the marker after the delegated call returns — keeps a crashed delegation from silently suppressing Step 0 on a later standalone run.
   - **Opt-out file** — `.claude/skip-nl-confirm-commit-pr.local` exists.

   When the gate fires, **before any other action** (no `gh auth`, no git commands), present via `AskUserQuestion`: "Run `/commit` with: *[detected context — echo any user guidance such as issue refs or commit-splitting instructions]*?" with options:

   - **Proceed** — continue to step 1.
   - **Proceed and don't ask again** — create `.claude/skip-nl-confirm-commit-pr.local` containing the standard note (below), then continue to step 1.
   - **Stop** — stop immediately, zero side effects.

   Standard opt-out file contents: `Skips only the natural-language intent confirmation (Step 0) for /commit and /pr. All approval checkpoints still apply. /ship is unaffected. Delete this file to re-enable.`

   This gate confirms only *intent detection* on the natural-language path; it is not the content-approval checkpoint (step 14), which still runs regardless. If you change this gate, re-run the verification checklist in `docs/plan-skill-nl-invocation.md`.

1. **Parse the argument** and cache it for downstream Skills (`/pr`, `/ship`) in the same session.

2. **Inspect working state.** Run `git status --short`, `git diff --name-status`, and `git diff --cached --name-status`. Inspect `git log origin/main..HEAD` for branch-history context.

3. **Refuse if there's nothing to commit.** If there are no staged, unstaged, or untracked payload files, say "nothing to commit" and stop.

4. **Auto-branch if HEAD is `main`.** Generate a slug `<N>-<short-summary>` (from `gh issue view <N>` when the argument is an issue) or `<short-summary>` from the diff. `git switch -c <branch>`. Never commit directly to `main`.

5. **Build the proposed payload** from the current task context and changed files. Do not use `git add .` or `git add -A` — those sweep in everything in the working tree and defeat the point of a deliberate payload.

6. **Apply the suspicious-file blocker check.** Refuse and surface the file(s) if any of the following match:

   - `.env*` files (any environment file)
   - Files matching common secret patterns (keys, tokens, credentials)
   - Generated or build artifacts: `.next/`, `out/`, `build/`, `playwright-report/`, `test-results/`
   - Lockfile changes (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) when the commit doesn't intentionally bump dependencies
   - Files unrelated to the apparent task area
   - Unexpectedly large files

   On match, refuse, name the file(s), and ask the human for direction (e.g., "remove from payload," "yes this is intentional, please include," or "split into a separate commit").

7. **Stage explicit paths.** `git add -- <paths>` for the approved files only. Never `git add .` or `git add -A`.

8. **Verify staging.** Run `git diff --cached --name-status`. If nothing is staged, refuse with the reason.

9. **Schema-change handling.** If the staged payload includes `src/server/schema.ts` or anything under `drizzle/`, identify the expand vs contract phase per `docs/strategy-committing.md`.

   - **Refuse combined expand+contract payloads.** The two phases must ship as separate commits so deploy ordering can be preserved. Ask the human to split.
   - **Expand-phase change.** In the eventual approval block, note that `npm run prod:db:expand` will need to be dispatched after PR creation (the dispatcher pauses on a maintainer approval gate in the `prod-db` environment before injecting prod credentials), and that the post-deploy `e2e.yml` run must pass before `/ship` merges.
   - **Contract-phase change.** No dispatch needed; the migration runs in Vercel's production build per `vercel.json`.

10. **Validate issue argument if present.** If the parsed argument looks like an issue, `gh issue view <N>` to confirm it exists and is open. **Fail fast and hard if `gh` is unavailable or unauthenticated** — suggest `gh auth login` / `gh auth status` as the next command.

11. **Run the local gate.** `npm test`. All suites must pass. This is the only local gate; if it's slow or flaky, the fix is to `npm test` itself, not to skip it here.

12. **Draft the commit message.** Use a Conventional Commit-style subject and the repo's structured body. First inspect `git log --oneline -20 origin/main` to follow the repo-observed style. Reference: https://www.conventionalcommits.org/en/v1.0.0/

    **Subject:** `<type>[(scope)]: <imperative summary>`, ≤70 chars.

    - Prefer repo-observed types: `feat`, `fix`, `a11y`, `test`, `docs`, `chore`. Use common CC types (`refactor`, `perf`, `ci`, `build`) when they fit.
    - If several types apply, pick the dominant intent. If unclear, surface the chosen type in the approval block so the human can correct it.
    - For breaking changes, add `!` before the colon and include a `BREAKING CHANGE:` footer that explains the compatibility impact. Surface this explicitly in the approval block.

    **Body sections, in order:**

    - `Summary:` — one sentence describing what the commit does.
    - `Why:` — the motivation; the constraint, bug, request, or hypothesis that drove the change.
    - `Behavior:` — the observable change (UI, API, schema, build, log output, etc.).
    - `Test Plan:` — evidence the change works.

    **Trailers, in order:**

    - `Closes #N` for issues this commit resolves. `(#N)` for non-resolving references.
    - AI co-author trailer (see protocol below).

    **Test-plan provenance.** Every line in `Test Plan:` is either (a) a command the agent actually ran with captured output, (b) a verbatim human attestation ("Blake checked the new modal on mobile Safari, no clipping"), or (c) the single collapsed line `ran \`npm test\` locally` when the full suite was run with no surprises. Never invent test results. Fabrication is the failure mode this provenance rule exists to prevent.

    **Test-plan formatting.** Use plain bullets (`- ran ...`), **not** Markdown task-list checkboxes (`- [ ]` / `- [x]`). The PR body becomes the durable merge commit message in this repo (`merge_commit_message: PR_BODY`), and unchecked task-list boxes look like outstanding work. If human-only verification remains, surface it as a pending action or reviewer note, not as completed test evidence. Don't add task-list checkboxes to commit messages or PR bodies unless they already come from the repo's PR template.

13. **Draft a devjournal entry if a trigger fires.** Triggers list below. Default length: **1–2 sentences.** Expand only on explicit human confirmation. Never auto-write more than three sentences.

14. **Human approval checkpoint — one bundled block.** Present all three together:

    - The full commit message (subject, body, trailers).
    - The exact staged payload: `git diff --cached --name-status`, the diffstat, and a list of any unstaged or untracked leftovers in the working tree.
    - The devjournal draft, if any.

    Wait for Y/n. Do not proceed without an explicit yes. After approval, run to completion through step 19.

15. **Re-verify staging after approval.** Run `git diff --cached --name-status` again. If the staged set has changed between approval and commit (race with another tool, edited a file, etc.), stop and re-show the approval block.

16. **Commit.** `git commit` with the message passed via a heredoc so multi-line formatting is preserved exactly.

17. **Verify post-commit working tree.** `git status --short`. If unexpected changes remain (a hook modified files, a generated artifact reappeared, etc.), report them.

18. **Push.** `git push -u origin <branch>` so the upstream is set on first push.

19. **Report.** Print the commit SHA and the remote-tracking info (e.g., `branch impl/portable-ai-procedures set up to track origin/impl/portable-ai-procedures`).

## Devjournal trigger list

A devjournal entry exists to change other teammates' behavior. Skip it for purely internal changes.

**Hard triggers — always draft:**

- New or removed dependency in `package.json`.
- New or changed required environment variable.
- New required local setup step (new Docker service, new daemon, new auth flow).
- CI or branch-protection change.
- New `.claude/skills/<name>/` Skill added.
- AI co-author trailer or commit-convention change.
- Schema migration requiring multi-deploy timing.

**Soft triggers — offer to draft; default skip unless human accepts:**

- Security-relevant change (auth, permission boundary, session handling) not covered above.
- Architectural decision affecting future code in the area.
- Convention-changing refactor visible to anyone editing the area.

**Don't trigger:**

- Bug fixes.
- Internal refactors with no API surface change.
- Performance optimizations.
- Test additions.
- Doc typo fixes.
- Internal renames.

## AI co-author trailer protocol

Every commit `/commit` writes includes an AI co-author trailer. This is required, not optional.

- **Detection path (preferred).** When the agent can read its own model identity from runtime context, emit the canonical form:

  `Co-Authored-By: <Model Name> <Version> <noreply@anthropic.com>`

  Example: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

- **Fallback path (when detection fails).** Ask the human **once** for the attribution string. Emit:

  `Co-Authored-By: <human-provided string> <noreply@unspecified>`

  And append a one-line caveat to the commit body: `Note: AI co-author identity provided by human; auto-detection failed.`

- **No multi-vendor matrix.** v1 is Claude-only. Don't try to recognize or emit non-Claude attribution.

## Stash safety

Do not use `git stash && <command>; git stash pop` to "test against a clean slate." `git stash` is a no-op when the tree is already clean — it does not push an empty marker — so the trailing `git stash pop` falls through to whatever was already on the stack, potentially applying leftover work from another branch. Read the current tree with `git status --short` / `git status --porcelain` and explicit diffs instead. If a branch switch would cross a dirty tree, refuse with a manual commit-or-stash suggestion to the human.

## Failure modes

- **No diff or branch identical to `main`.** Refuse; suggest the next command.
- **Suspicious-file match in the blocker list.** Refuse; surface the file; await human direction.
- **Combined expand+contract schema payload.** Refuse; ask the human to split into two commits.
- **`gh` unavailable or unauthenticated** when issue lookup is needed. Refuse; name the command to run (`gh auth login` / `gh auth status`).
- **`npm test` fails.** Refuse; show the failing test output.
- **Schema touch with unresolved expand-vs-contract phase.** Refuse; ask which phase.
- **Human rejects message draft, devjournal draft, or staged payload** at the approval checkpoint. Return to staging with the rejection reason captured.
- **Staged payload changes between approval and commit.** Stop and re-show the approval block.
- **Commit hook fails.** Report the hook's exit; do not retry without human input.
- **Push fails.** Report the error; do not retry blindly.
- **Never** use `--no-verify`, `--amend` without explicit human approval, force-push, `git add -A` / `git add .`, admin bypass, or invented attribution.

## Depends on

- `CLAUDE.md`
- `package.json` (for `npm test`)
- `docs/strategy-committing.md` (commit format, expand-contract phase rules, AI-trailer subsection, stash-safety note)
- `docs/strategy-branching.md` (feature-branch-from-main rule)
- `docs/doc-github.md` (GitHub settings, merge-commit-only, `merge_commit_message: PR_BODY`)
- `docs/strategy-project-management.md` (issue → board automation; closing-keyword behavior)
- `.github/workflows/ci.yml` (the gate the local `npm test` mirrors)
- `.github/workflows/forward-migrate-prod-schema-expansion.yml` (the workflow `/ship` dispatches for expand changes)
- `gh` CLI (issue lookup, authentication state)
