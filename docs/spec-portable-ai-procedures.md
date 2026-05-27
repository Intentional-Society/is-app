# Portable AI Procedure Framework

> Design RFC for encoding the team's check-in workflow as three Claude Code Skills. Reviewed via PR #133. This document supersedes prior v1–v4 drafts.

## 1. Overview

### Problem statement

Team members using AI coding assistants follow the team's check-in conventions only as well as their personal prompting and memory allow. Execution drifts across teammates and across tool-switches. v1 encodes the check-in workflow as three Claude Code Skills (`/commit`, `/pr`, `/ship`) that any teammate using Claude Code can invoke explicitly to get the same behavior.

### Goals

- Implement `/commit`, `/pr`, `/ship` as Claude Code Skills under `.claude/skills/`.
- Encode concrete local, GitHub, CI, merge, cleanup, and monitoring behavior — leave nothing to private prompting or memory.
- Preserve the existing repo gates: `npm test` locally, branch-protected PRs into `main`, all pre-merge checks green, human approval at the points that require judgment.
- Build each Skill via Anthropic's `skill-creator` workflow so the resulting body is description-optimized and self-contained.
- Keep the surface area small enough for a 4–5 person part-time team to maintain.
- Self-host: once the Skills exist, use them for follow-on commits to the repo itself.

### Non-goals

- Codex, GitHub Copilot, Aider, Cursor, or any non-Claude-Code agent in v1.
- `AGENTS.md`, `.agents/skills/`, `.github/skills/`, `.github/copilot-instructions.md`, or any adapter architecture.
- Multi-phase rollout for cross-tool support.
- `.claude/commands/*`, `argument-hint`, or `$ARGUMENTS`.
- Helper commands (`/journal`, `/migrate`, `/rollback`), hooks, daemons, custom CLI, workflow engine.
- Generalized skills marketplace or procedure framework.
- Replacement for human PR review.
- `/pr --auto-ship`, `/pr --auto-merge`, `gh pr merge --auto`, or any server-side auto-merge.
- Squash-merge or rebase-merge options (the repo disables both at the settings level).
- Merging through red, missing, or pending pre-merge checks. No "Proceed anyway."
- "Future-proofing" features without a concrete v1 need.

### Constraints we accept

- Claude Code Skills are the only v1 execution surface. No `.claude/commands/*`.
- Argument shapes are documented in each `SKILL.md` body's Invocation section. `argument-hint` and `$ARGUMENTS` are slash-command-format affordances; v1 does not use them.
- Each Skill sets `disable-model-invocation: true` in frontmatter — explicit invocation only. Natural-language phrasings are guidance for the human reading the Skill, not triggers the Skill responds to automatically. If Claude Code's current Skills implementation does not recognize this frontmatter key, the Skill body documents the equivalent explicit-invocation requirement.
- `npm test` is the local gate as authored in `package.json` (lint + typecheck + dev-DB setup + Vitest + Playwright e2e). If `npm test` is too slow or flake-prone, the team fixes `npm test`, not the Skill's gate.
- `gh` (GitHub CLI) is required for GitHub-side operations. Unavailability or unauthenticated state is a hard stop with a clear next command (`gh auth login` / `gh auth status`).
- Branch protection requires up-to-date branches before merge. Rebase is the normal pre-push action; merge-to-update is a human-judgment override (active review, recurring conflicts, or rebase would misrepresent commits).
- Every visible pre-merge check (required + advisory) must be green before `/ship` merges. No "Proceed anyway" option.
- Post-merge monitoring is foreground and bounded to 5 minutes.
- Canonical procedure content lives in each `SKILL.md` body. Each `SKILL.md` ends with `## Depends on` listing policy docs, scripts, workflows, and config it relies on. Strategy docs are referenced, not restated.
- `/commit` has one bundled human approval checkpoint per invocation.
- The spec stands alone: a reader does not need to open any other file to understand procedure behavior.

## 2. Validated context

### Tool/platform assumptions (Claude Code Skills only)

- Project Skills live at `.claude/skills/<name>/SKILL.md`.
- Each `SKILL.md` has YAML frontmatter with `name`, `description`, and `disable-model-invocation: true` (or equivalent body documentation if the key is unrecognized).
- The directory name is the slash-style invocation name: `/commit`, `/pr`, `/ship`.
- The `SKILL.md` body contains Invocation → Steps → Failure modes → `## Depends on` footer.
- Side-effecting Skills require explicit invocation: `/commit ...`, `/pr ...`, `/ship ...`. Natural-language matches do not fire them.
- `argument-hint` and `$ARGUMENTS` are slash-command-format keys that do not apply to Skills. Argument shapes are documented in the `SKILL.md` body.
- `gh` (GitHub CLI) is required for GitHub-side work; unavailability or unauthenticated state is a hard stop.

### Repo assumptions

- Root `CLAUDE.md` instructs teammates to run `npm test` before committing.
- `package.json` defines `npm test` = `npm run lint && npm run typecheck && npm run dev:db && vitest run && playwright test`.
- `package.json` defines `npm run prod:db:expand` for forward schema expansion. `npm run prod:db:expand` is a workflow-dispatcher (not a local migration runner): it triggers the `forward-migrate-prod-schema-expansion` workflow against the pushed branch, which runs in the `prod-db` GitHub Actions environment, surfaces the PR link and migration SQL, and requires manual maintainer approval before applying additive migrations to the production database.
- Branch protection on `main` requires the `Lint & Functional Tests` status check (managed by `scripts/update-main-branch-protection.mjs`) and requires branches to be up-to-date before merging (`strict_required_status_checks_policy: true`).
- Repo PR settings allow only merge-commit (`allow_merge_commit: true`); `allow_squash_merge` and `allow_rebase_merge` are `false`. The merge command is always `gh pr merge --merge --delete-branch`. Squash and rebase merging are not options the merge button can pick. (Local commit squashing via `git rebase -i` before push is a developer choice outside the Skills' scope; the repo setting only controls the server-side merge method.)
- Merge commit composition: `merge_commit_title: "PR_TITLE"` and `merge_commit_message: "PR_BODY"`. GitHub uses the PR title verbatim as the merge commit subject (no "Merge pull request #N from …" prefix) and the PR body verbatim as the merge commit message. PR title and body are durable `main` history, not just review context.
- `allow_auto_merge: false` and `allow_update_branch: true`. GitHub-side auto-merge is off; the "Update branch" button is available but the Skills do local rebase instead so the post-update gate (`npm test`) can re-run.
- `delete_branch_on_merge: true` removes the remote branch automatically on merge; `/ship` still passes `--delete-branch` to `gh pr merge` as explicit cleanup intent.
- `ci.yml` runs lint + typecheck + migrations + functional tests for non-docs PRs into `main`. It uses `dorny/paths-filter` to detect docs-only changes; on docs-only PRs the test steps skip but the job still reports `Lint & Functional Tests` success, satisfying branch protection.
- Docs-only means the branch diff vs `origin/main` is confined to `docs/**` and root `CLAUDE.md`.
- `e2e.yml` runs Playwright against Vercel deployments, gated by `github.event.deployment_status.environment` in {`Preview`, `Production`}. E2E is advisory but still blocks `/ship` when visible and not green.
- `vercel.json`'s `ignoreCommand` skips Vercel preview builds for docs-only branch diffs.
- Schema source is `src/server/schema.ts`; migrations live under `drizzle/`. Expand-contract policy is in `docs/strategy-committing.md`.
- Project-board automation flips linked issues to `In progress` on PR-link and `Done` on PR-merge per `docs/strategy-project-management.md`. Closing keywords (`Closes #N`, `Fixes #N`, `Resolves #N`) create the linked-PR relationship; `(#N)` references are visible context but do not.

## 3. Architecture

### File layout

Three new executable artifacts:

```text
.claude/skills/
  commit/SKILL.md
  pr/SKILL.md
  ship/SKILL.md
```

Each `SKILL.md` has YAML frontmatter (`name`, `description`, `disable-model-invocation: true`) and a body structured as: Invocation → Steps → Failure modes → `## Depends on` footer. Optional bundled `references/<topic>.md` files inside a skill folder are allowed if the body exceeds the ~500-line soft cap from `skill-creator`; v1 does not pre-create them.

Edits to existing files (the only other artifacts in this PR):

- `CLAUDE.md` — adds a short "AI Skills" section pointing at `.claude/skills/` and naming the three Skills.
- `docs/strategy-committing.md` — gains a subsection capturing the AI co-author trailer protocol (§4.1), so policy and Skill stay in sync.
- `docs/strategy-branching.md`, `docs/doc-github.md`, `docs/strategy-project-management.md` — each gains a one-line "Related Skills" back-link.
- `README.md` — adds a short "Working with AI assistants" section pointing at `.claude/skills/`.
- `.github/PULL_REQUEST_TEMPLATE.md` — adds one checklist item: "If this PR changes `.claude/skills/**/SKILL.md`, smoke-test the affected Skill on a realistic prompt."

Not in v1: `docs/ai-procedures/` tree, index file, `AGENTS.md`, `.agents/skills/`, `.github/skills/`, `.github/copilot-instructions.md`, adapter directories, `.claude/commands/*`, hooks, daemons, helper scripts.

### Skill-builder workflow (build process per skill-creator)

Each Skill is built using Anthropic's `skill-creator` workflow:

1. Capture trigger intent — the explicit user inputs that should fire the Skill via `/<name>`.
2. Draft `SKILL.md` with frontmatter (`name`, `description`, `disable-model-invocation: true`) and an imperative body following the Invocation → Steps → Failure modes → `Depends on` shape. Keep each body under the 500-line soft cap.
3. Write 2–3 realistic eval prompts in `evals/evals.json`: happy path, refusal, one edge case.
4. Run with-skill vs baseline subagents in parallel; capture outputs.
5. Review outputs via `eval-viewer/generate_review.py`; iterate the body based on feedback.
6. Run the description-optimization loop via `scripts/run_loop.py`. With `disable-model-invocation: true`, this tunes the description for human readability and slash-invocation discoverability rather than for natural-language firing.
7. Forward-test each Skill on realistic prompts before shipping.
8. Do not add README, changelog, quick-reference, or auxiliary docs inside Skill folders.

Per-skill acceptance: passes its eval set; body ≤500 lines; description is description-optimized; `## Depends on` footer is accurate and complete; the Skill self-hosts (it can be used to commit changes to itself).

### Anti-drift mechanisms

1. Each `SKILL.md` ends with a `## Depends on` footer listing policy docs, scripts, workflows, and config files it relies on. Example:

   ```markdown
   ## Depends on

   - CLAUDE.md
   - package.json
   - .github/workflows/ci.yml
   - vercel.json
   - docs/strategy-committing.md
   - docs/strategy-branching.md
   - docs/doc-github.md
   - docs/strategy-project-management.md
   ```

2. The PR template's smoke-test checklist item fires when `.claude/skills/**/SKILL.md` is touched.
3. Each of `docs/strategy-committing.md`, `docs/strategy-branching.md`, `docs/doc-github.md`, `docs/strategy-project-management.md` carries a one-line "Related Skills" back-link so a strategy-doc edit prompts a Skill review.
4. After substantive body edits, re-run `scripts/run_loop.py` description-optimization to confirm the description has not drifted out of triggering accuracy.

Reference, don't restate: facts that live in strategy docs (commit format conventions, expand-contract phase rules, AI co-author trailer rules) are inlined into each `SKILL.md` body only at the level an implementer needs. The strategy doc remains the source of rationale.

## 4. Procedure behavior

The three Skills delegate downward: `/ship` calls `/pr` if needed; `/pr` calls `/commit` if needed; `/commit` is the leaf. There is no upward chaining and no second path to the full workflow — `/ship` is the only way to run the chained commit → PR → merge sequence.

### 4.1 `/commit`

**Invocation.** `/commit [issue-or-context]`. Argument handling:

- No argument: infer context from branch name and diff.
- `#<N>` or bare `<N>`: treat as an issue number; resolve with `gh issue view <N>`.
- Text: use as plain-language context for branch naming, issue-lookup hints, and commit-message draft.

Argument is cached for `/pr` and `/ship` in the same session. Natural-language phrasings ("commit this for issue 142") are guidance for the human, not triggers — the Skill fires only on explicit `/commit` slash invocation per `disable-model-invocation: true`.

**Steps.**

1. Parse `[issue-or-context]`; cache for downstream Skills.
2. Run `git status --short`, `git diff --name-status`, and `git diff --cached --name-status`. Inspect `git log origin/main..HEAD` for branch-history context.
3. If there are no staged, unstaged, or untracked payload files, refuse: "nothing to commit."
4. If `HEAD` is `main`, auto-create a feature branch named `<N>-<slug>` (from `gh issue view <N>` when argument is an issue) or from a short summary of the diff; `git switch -c <branch>`.
5. Build the proposed payload from the current task context and changed files. Do not use `git add .` or `git add -A`.
6. Apply the suspicious-file blocker list and refuse if any match: `.env*` files; common secret-pattern matches; generated/build artifacts (`.next/`, `out/`, `build/`, `playwright-report/`, `test-results/`); lockfile changes (`package-lock.json`, etc.) without dependency intent in this commit; unrelated files outside the apparent task area; unexpectedly large files.
7. Stage only explicit paths with `git add -- <paths>`.
8. Run `git diff --cached --name-status`; if nothing is staged, refuse.
9. If schema files changed (`src/server/schema.ts` or `drizzle/**`), identify expand vs contract phase per `docs/strategy-committing.md`. **Refuse combined expand+contract payloads** in a single commit — the two phases must ship as separate commits so the deploy ordering can be preserved. For an expand-phase change, note that `npm run prod:db:expand` dispatches the schema deploy after PR creation and that the post-deploy `e2e.yml` rerun must pass before `/ship` merges.
10. If the parsed argument looks like an issue, `gh issue view <N>` to validate it exists and is open. Fail fast and hard if `gh` is unavailable or unauthenticated (suggest `gh auth login` / `gh auth status`).
11. Run `npm test`. All must pass.
12. Draft the commit message using a Conventional Commit-style subject and the repo's structured body convention. Inspect `git log --oneline -20 origin/main` for recent examples and follow the repo-observed style.
    - Subject format: `<type>[(scope)]: <imperative summary>`, ≤70 chars. Reference: https://www.conventionalcommits.org/en/v1.0.0/
    - Prefer repo-observed types such as `feat`, `fix`, `a11y`, `test`, `docs`, and `chore`; use common Conventional Commit types such as `refactor`, `perf`, `ci`, and `build` when they fit.
    - If several types apply, choose the dominant intent; if unclear, surface the proposed type in the human approval block.
    - For breaking changes, add `!` before the colon and include a `BREAKING CHANGE:` footer explaining the compatibility impact. Surface this explicitly in the human approval block.
    - Subject ≤70 chars.
    - Body sections in order: `Summary:` (one sentence), `Why:`, `Behavior:`, `Test Plan:`.
    - Append `Closes #N` for resolving references, `(#N)` for non-resolving.
    - Append the AI co-author trailer per the protocol below.
    - Test-plan provenance: every `Test Plan:` line is a command the agent ran with captured output, a verbatim human attestation, or one collapsed "ran `npm test` locally" line — never invented.
    - Test-plan formatting: use plain bullets for evidence, not Markdown task-list checkboxes (`- [ ]` / `- [x]`). If human-only verification remains, surface it as a pending human action or reviewer note, not as completed test evidence. Do not add task-list checkboxes to commit messages or PR bodies unless they already come from the repository's PR template; GitHub does not auto-check them, and PR bodies become durable merge-commit messages in this repo.
13. Draft a `docs/devjournal.md` entry if and only if the change meets a trigger from the devjournal list below. Length: 1–2 sentence default; expand only on explicit human confirmation; never auto-write more than three sentences.
14. **Human approval checkpoint.** Show all three in one bundled block: the full commit message; the exact staged payload (`git diff --cached --name-status`, diffstat, any unstaged/untracked leftovers); the devjournal draft if any. Await Y/n. After approval, run to completion.
15. Verify the staged payload has not changed between approval and commit. If it has, stop and re-show the approval block.
16. `git commit` using a heredoc for the message.
17. Run `git status --short`; if unexpected changes remain, report them.
18. `git push -u origin <branch>`.
19. Report the commit SHA and the remote tracking info.

**Devjournal trigger list.**

Hard triggers (always draft):
- New or removed dependency in `package.json`.
- New or changed required environment variable.
- New required local setup step (new Docker service, new daemon, new auth flow).
- CI or branch-protection change.
- New `.claude/skills/<name>/` Skill added.
- AI co-author trailer or commit-convention change.
- Schema migration requiring multi-deploy timing.

Soft triggers (offer to draft; default skip unless human accepts):
- Security-relevant change (auth, permission boundary, session handling) not covered above.
- Architectural decision affecting future code in the area.
- Convention-changing refactor visible to anyone editing the area.

Don't trigger:
- Bug fixes.
- Internal refactors with no API surface change.
- Performance optimizations.
- Test additions.
- Doc typo fixes.
- Internal renames.

**AI co-author trailer protocol.**

- Always include the AI co-author trailer in the human-approved commit message.
- When the agent can read its own model identity from runtime context, emit the canonical form: `Co-Authored-By: <Model Name> <Version> <noreply@anthropic.com>` (e.g., `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`).
- When detection fails, ask the human once for the attribution string. Emit `Co-Authored-By: <human-provided string> <noreply@unspecified>` and append a one-line caveat in the commit body: `Note: AI co-author identity provided by human; auto-detection failed.`
- No multi-vendor matrix; v1 is Claude-only.

**Failure modes.**

- No diff or branch identical to `main`: refuse, suggest the right next command.
- Suspicious file matches the blocker list: refuse, surface the file, await human direction.
- Combined expand+contract schema payload: refuse, ask the human to split into two commits.
- `gh` unavailable or unauthenticated when issue lookup is needed: refuse, name the command to run (`gh auth login` / `gh auth status`).
- `npm test` fails: refuse, show the failing test output.
- Schema-touch with unresolved expand-contract phase: refuse, ask which phase.
- Human rejects the message draft, devjournal draft, or staged payload at the approval checkpoint: return to staging step with the rejection reason.
- Staged payload changes between approval and commit: stop and re-show the approval block.
- Commit hook fails: report the hook's exit; do not retry without human input.
- Push fails: report the error; do not retry blindly.
- Never use `--no-verify`, `--amend` without explicit human approval, force-push, `git add -A`/`.`, admin bypass, or invented attribution.

### 4.2 `/pr`

**Invocation.** `/pr [PR#|URL|issue-or-context]`. Argument resolution order:

1. URL parses as a PR URL → existing PR.
2. Integer resolves via `gh pr view <N>` → existing PR.
3. Integer resolves via `gh issue view <N>` → issue context (treated like `/commit`'s issue-or-context).
4. Anything else → plain-language context.

No `/pr --auto-ship` and no `/pr --auto-merge` — `/ship` is the chained workflow.

**Steps.**

1. Run `gh auth status`; if it fails, refuse and print `gh auth login`.
2. Resolve the argument using the order above.
3. If the resolved PR is on a branch different from the current checkout, refuse — `/pr` does not switch branches. Suggest `/ship <PR#>` for branch-switching.
4. Working-tree pre-flight: if `git status --porcelain` is non-empty OR HEAD is `main`, delegate to `/commit` with the same argument, then continue.
5. `git fetch origin main`.
6. If `git merge-base --is-ancestor origin/main HEAD` fails (main has moved), `git rebase origin/main`. On rebase conflict, abort the rebase, report the conflicted files, and hand control to the human.
7. If the rebase changed anything, re-run `npm test`. Skip the re-run if the rebase was a no-op.
8. `git push -u origin <branch>`. Use `--force-with-lease` only if the rebase rewrote already-pushed commits.
9. If no open PR for this branch: draft PR title and body using the same Conventional Commit-style headline rule as `/commit` and the repo's `Summary:` / `Why:` / `Behavior:` / `Test Plan:` body convention. Title is `<type>[(scope)]: <imperative summary>`, ≤70 chars, including `!` for breaking changes (GitHub uses it verbatim as the merge commit subject per `merge_commit_title: PR_TITLE`). Body uses the structured convention (GitHub uses it verbatim as the merge commit message per `merge_commit_message: PR_BODY`). Append the AI co-author trailer to the PR body using the same protocol as `/commit`. `/commit` test-plan provenance and formatting rules apply. Present the draft for human approval, then `gh pr create`.
10. If an open PR for this branch exists: post a short PR-conversation comment summarizing each new commit (one bullet per commit). Update the PR body only if the new commits materially change the PR's scope, and ask for human approval before saving (because the body becomes the merge commit message).
11. Print the PR URL. Stop. `/pr` does not poll CI checks; that is `/ship`'s job.

**Failure modes.**

- `gh` unavailable or unauthenticated: refuse loudly.
- Argument resolves to a PR on a different branch from the current checkout: refuse, name both branches, suggest `/ship <PR#>` for switching.
- Rebase conflict during `git rebase origin/main`: abort the rebase, report conflicted files, hand to human.
- `npm test` fails after rebase: refuse, surface the failing test.
- `gh pr create` fails or PR-comment update fails: report the error; do not retry blindly.
- Human rejects PR draft text or body-update proposal: return to step 9 or 10 with the rejection reason.
- Duplicate-PR would result: refuse.
- Never enable GitHub-side auto-merge. Never silently force-push.

### 4.3 `/ship`

**Invocation.** `/ship [PR#|URL|issue-or-context]`. Argument resolution: same as `/pr`. If `[PR#|URL]` resolves to a PR on a different branch from the current checkout, `/ship` may switch branches — but only after verifying the current branch's working tree is clean. If not clean, refuse with a suggestion to commit or stash.

No `--squash` flag. Repo PR settings disable squash and rebase merging (only merge-commit is allowed); the merge command is always `gh pr merge --merge --delete-branch`. Re-enabling squash is a repo-policy decision, not a Skill flag.

**Steps.**

1. Run `gh auth status`; if it fails, refuse and print `gh auth login`.
2. Parse arguments; resolve target PR. If the argument names a different branch AND the current working tree is clean, `git switch <target-branch>`. If the current working tree is not clean, refuse with a clear suggestion (commit or stash).
3. Working-tree pre-flight: if dirty or on `main` with no PR for the current branch, delegate to `/pr` (which delegates to `/commit` per §4.2).
4. `git fetch origin main`. Do not use shallow-fetch shortcuts for freshness checks (a shallow fetch breaks `merge-base` and was the root cause of a recent expand-workflow bug).
5. If `git merge-base --is-ancestor origin/main HEAD` fails (main has moved), `git rebase origin/main`. On rebase conflict, abort and surface.
6. If the rebase changed anything, re-run `npm test`, then `git push --force-with-lease`.
7. If a schema expand from `/commit` is pending and not yet deployed, run `npm run prod:db:expand` to dispatch the `forward-migrate-prod-schema-expansion` workflow against the pushed branch. Surface the workflow run URL, PR link, and migration SQL approval context to the human. Wait for the maintainer approval in the `prod-db` environment (the workflow pauses on a review gate before prod credentials are injected). Once the workflow completes successfully, wait for the next `e2e.yml` run on the post-deploy commit and require it to pass before continuing.
8. Wait for CI via `gh pr checks <N> --watch`. The required check (`Lint & Functional Tests`) plus every visible advisory check (E2E, CodeQL, and any others present) must be green. Wait up to 5 minutes for pending advisories. After 5 minutes, present three options: `wait+5`, `troubleshoot`, `abort`. There is no `proceed` option.
9. Docs-only PR handling: if the PR's diff is confined to `docs/**` and root `CLAUDE.md`, `ci.yml`'s `dorny/paths-filter` step skips test steps but still posts `Lint & Functional Tests` green within seconds. Vercel preview is skipped per `vercel.json`'s `ignoreCommand`, so no preview `deployment_status` event fires and preview `e2e.yml` does not run. `/ship` treats the absent pre-merge advisory checks as expected per `docs/doc-github.md`'s docs-only rule; proceed on required-green.
10. Confirmation policy: if `/ship` opened the PR during this same run (via delegated `/pr` create), present a final Y/n merge confirmation. If the PR pre-existed at `/ship` invocation, the `/ship` invocation itself is the merge confirmation — narrate the merge in one line and proceed.
11. Merge: `gh pr merge <N> --merge --delete-branch`. Do not pass `--merge-title` or `--body` flags — GitHub uses the PR title and body verbatim per the repo's `merge_commit_title: PR_TITLE` / `merge_commit_message: PR_BODY` settings. Never `--admin`, `--auto`, force-merge, `--squash` (repo-disabled), or branch-protection bypass.
12. Tidy: `git switch main && git pull --ff-only`; `git branch -d <feature-branch>` if the local branch still exists and is fully merged. Confirm the remote branch was deleted (`delete_branch_on_merge: true` should handle it automatically).
13. Capture the merge SHA (`git log -1 --format=%H` on `main` after `git pull`). Run `gh run list --branch main --commit <merge-sha> --limit 10` to discover post-merge runs.
14. Post-merge watch: poll runs on `main` for the merge commit via `gh run watch <run-id>` for up to 5 minutes. Expected runs: Vercel production deploy plus `e2e.yml` against the production environment. On any red: alert immediately with the failing check name, run URL, and a suggested next action (open hotfix branch or revert). On still-pending at 5 minutes: report what's pending; offer `wait+5`. On all-green: report merge SHA + Vercel production URL + "main: green."

**Failure modes.**

- No resolvable PR for the argument: refuse with a clear next command.
- Target branch can't be safely checked out (dirty working tree on current branch): refuse with a suggestion to commit or stash.
- `gh` unavailable or unauthenticated: refuse loudly.
- Rebase conflict during freshness update: abort, surface, hand to human.
- `npm test` fails after rebase: refuse, surface.
- Any pre-merge check is red, pending past wait limits, or missing where it shouldn't be missing: refuse and offer the three supervised-handoff options (`wait+5`, `troubleshoot`, `abort`).
- Schema expand required but `npm run prod:db:expand` dispatch fails, maintainer approval is denied, or post-deploy e2e fails: refuse, surface the failing run.
- `gh pr merge` rejected by branch protection or ruleset enforcement: surface the protection rule that blocked.
- Local branch deletion fails: report; do not retry blindly.
- Post-merge `main` check goes red within the watch window: alert; suggest hotfix or revert. The watch reports; it does not auto-act.
- Never use "Proceed anyway," force-merge, admin bypass, `gh pr merge --auto`, `--squash`, `--merge-title`, or `--body` flags.

## 5. Requirements

Each P0 row references the §4 step(s) or section(s) that satisfy it and the PR #133 review comment IDs it addresses. The full comment-to-section coverage table is in Appendix A.

| P0 | Requirement | Satisfied by | Prior PR Comment ID(s) |
|---|---|---|---|
| P0.1 | v1 surface is Claude Code Skills only; no Codex / Copilot / AGENTS.md / Aider / adapter architecture | §1, §2, §3 | `3211314771`, `3211556445`, `3206339198`, `3206341799` |
| P0.2 | Canonical procedure content lives in `.claude/skills/<name>/SKILL.md`; no docs-tier procedure tree, no index file | §3 File layout | `3211278267`, `3211334197`, `3211336168` |
| P0.3 | Argument shapes documented in SKILL.md body Invocation sections; no `.claude/commands/*`; no `argument-hint`; no `$ARGUMENTS` | §4.1, §4.2, §4.3 Invocation | `3211328311`, `3211383252`, `3211510381`, `3211537639` |
| P0.4 | Skills set `disable-model-invocation: true`; firing only on explicit slash invocation | §2, §3, §4 Invocation | `3211328311` |
| P0.5 | `/commit` auto-branches on `main`, stages explicit paths, applies the suspicious-file blocker list, runs a single human approval checkpoint with payload + message + devjournal bundled, commits, pushes | §4.1 Steps | `3211344951`, `3211395406`, `3211451058`, `3211455859`, `3211441775` |
| P0.6 | `/commit` protects against accidental payload inclusion via deterministic staging + post-stage verification + post-commit verification | §4.1 Steps 5–8, 14–17 | Blake Thread 9 |
| P0.7 | `npm test` is the local gate everywhere | §4.1 Steps, §4.2 Steps, §4.3 Steps | `3206302965`, `3211409060`, `3270728996` |
| P0.8 | Devjournal entries use the hard/soft/don't-trigger list; 1–2 sentence default; never auto-write more than three sentences | §4.1 Steps + Devjournal trigger list | `3211401187`, `3211405546` |
| P0.9 | Schema expand surfaces in `/commit`; `/commit` refuses combined expand+contract payloads; deploys via `npm run prod:db:expand` after PR creation; requires post-deploy e2e to pass before `/ship` merges | §4.1 Steps, §4.3 Steps | `3211427829`, Blake §C.2 |
| P0.10 | `gh` unavailable is a hard fail with the next command named | §4.1, §4.2, §4.3 Failure modes | `3211429215` |
| P0.11 | AI co-author trailer required; detect-or-ask-with-body-caveat protocol on detection failure; Claude-only | §4.1 Steps + Trailer protocol | `3211436201` |
| P0.12 | `/pr` delegates dirty / on-main states to `/commit`, opens or updates the PR, prints the URL, does not watch CI | §4.2 Steps | `3211364094`, `3211469479`, `3211483870`, `3211497578` |
| P0.13 | `/pr` always `git fetch origin main` first; rebases by default if `main` moved (via `merge-base --is-ancestor`); re-runs `npm test` after rebase | §4.2 Steps | `3211491714`, `3211489349`, `3211523650`, `3277828039` |
| P0.14 | `/pr` posts a thread comment summarizing new commits on existing-PR push; body update only on material scope change with human approval | §4.2 Steps | `3211503556` |
| P0.15 | `/ship` is a thin orchestrator over `/pr`: wait for all-green, merge, tidy, watch `main` | §4.3 Steps | `3211374772`, `3211394461`, `3211507898` |
| P0.16 | `/ship` never merges through red, missing, or pending checks; no Proceed option | §4.3 Steps, §4.3 Failure modes | `3211516014`, `3211549081` |
| P0.17 | `/ship` confirms only when it opened the PR this run; merge mode is repo-policy-driven merge-commit-only (no `--squash` flag) | §4.3 Invocation, §4.3 Steps | `3211534869`, `3211537639` |
| P0.18 | `/ship` post-merge watch on `main` for up to 5 minutes; alerts immediately on red | §4.3 Steps | `3211544467` |
| P0.19 | `/ship` accepts `[PR#|URL]` and switches branches safely; `/pr` refuses to switch | §4.3 Invocation, §4.3 Steps; §4.2 Steps | `3211510381` |
| P0.20 | `/ship` uses no shallow-fetch shortcuts for freshness checks; does not pass `--merge-title` or `--body` flags to `gh pr merge` | §4.3 Steps, §4.3 Failure modes | PR #236, PR #254 |
| P0.21 | Skills are built via the `skill-creator` workflow; each Skill passes its own eval set; description-optimized | §3 Skill-builder workflow | `3211328311`, `issuecomment-4465701122` |
| P0.22 | Complexity / scope-creep is the organizing principle; v1 has one clear path | §1, §3, §4 | `pullrequestreview-4249527087`, `3211556445` |

## Appendix A: Reviewer comment coverage table

Every James-authored comment from PR #133 plus the two post-ledger comments (`3270728996`, `3277828039`) and the review-summary `pullrequestreview-4249527087`. Each ID links to its PR conversation anchor.

| Comment ID | Spec section | Resolution | Summary |
|---|---|---|---|
| [`issuecomment-4403354932`](https://github.com/Intentional-Society/is-app/pull/133#issuecomment-4403354932) | Meta | No spec action | Versioned working drafts; canonical doc is unversioned. |
| [`issuecomment-4465701122`](https://github.com/Intentional-Society/is-app/pull/133#issuecomment-4465701122) | §3 | Middle path | Prior art surveyed (Claude Skills, OpenSpec, MCPMarket); Claude Skills chosen on repo-specific-policy grounds. |
| [`3211314771`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211314771) | §1, §2, §3 | Accept | v1 Claude-only. |
| [`3206341799`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3206341799) | §1 Non-goals | Accept | Aider dropped. |
| [`3206302965`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3206302965) | §1 Constraints, §4 Steps | Accept | `npm test` is the gate. |
| [`3270728996`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3270728996) | §1 Constraints | Accept (Blake confirmation) | "Keeping `npm test` the authority." |
| [`3206339198`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3206339198) | §1 Non-goals | Accept | AGENTS.md dropped. |
| [`3211278267`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211278267) | §3 | Accept | "Procedure" term dropped in favor of "Skill" as the v1 unit. |
| [`3211328311`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211328311) | §2, §3 | Accept (endorsement) | Skills format chosen; `disable-model-invocation: true` set in frontmatter. |
| [`3211334197`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211334197) | §3 | Accept | Folder-per-skill is required by Skills format; no outer adapter layer. |
| [`3211336168`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211336168) | §3 | Accept | No `docs/ai-procedures/index.md`. |
| [`3211344951`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211344951) | §4.1 Steps | Accept | `/commit` auto-branches on `main` and pushes. |
| [`3211364094`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211364094) | §4.2 Steps | Accept | `/pr` delegates dirty/on-main to `/commit`; stops after PR open/update; does not watch CI. |
| [`3211374772`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211374772) | §4.3 Steps | Accept | `/ship` is a thin orchestrator. |
| [`3211383252`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211383252) | §4.2 Invocation | Accept | No `/pr --auto-ship` or `--auto-merge`; `/ship` is the chained workflow. |
| [`3211394461`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211394461) | §4 | Accept | Prose state-dispatch dropped; step lists are the dispatcher. |
| [`3211395406`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211395406) | §4.1 Steps | Accept | `/commit` auto-creates a feature branch from `main`. |
| [`3211401187`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211401187) | §4.1 Devjournal | Accept | Devjournal entries are brief: 1–2 sentence default. |
| [`3211405546`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211405546) | §4.1 Devjournal | Accept | Trigger is "needs to change teammates' actions/behavior," operationalized as hard/soft/don't lists. |
| [`3211409060`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211409060) | §1 Constraints, §4 Steps | Accept | "Just run `npm test`." |
| [`3211427829`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211427829) | §4.1 Steps, §4.3 Steps | Accept (with defense-in-depth extension) | Schema expand surfaces in `/commit`; deploys after PR creation; post-deploy e2e required. `/commit` also refuses combined expand+contract payloads per Blake's §C.2 decision (defense-in-depth beyond James's literal ask; **James confirmed 2026-05-23**). |
| [`3211429215`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211429215) | §4.1/2/3 Failure modes | Accept | `gh` unavailable is a hard fail. |
| [`3211436201`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211436201) | §4.1 Trailer protocol | Middle | Required trailer; detect-or-ask-with-body-caveat; Claude-only. |
| [`3211455859`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211455859) | §4.1 Steps | Accept | Single human approval at the bundled commit-checkpoint. |
| [`3211451058`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211451058) | §4.1 Steps | Accept | Stage explicit paths before drafting the message. |
| [`3211441775`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211441775) | §4.1 Steps | Accept | `/commit` pushes; does not stop at the commit. |
| [`3211469479`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211469479) | §4.2 Steps | Accept | Dirty `/pr` delegates to `/commit`. |
| [`3211483870`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211483870) | §4.2 Steps | Accept | `/pr` on `main` delegates to `/commit`. |
| [`3211491714`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211491714) | §4.2 Steps | Accept | `git fetch origin main` first; rebase before re-running gate. |
| [`3211489349`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211489349) | §4.2 Steps, §4.3 Steps | Accept | "Always rebase" — encoded as "rebase if main moved" (via `merge-base --is-ancestor`). |
| [`3211497578`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211497578) | §4.2 Steps | Accept | `/pr` does not poll CI immediately. |
| [`3211503556`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211503556) | §4.2 Steps | Middle | Comment by default; body update only on material scope change with human approval. |
| [`3211507898`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211507898) | §4.3 Steps | Accept | `/ship` relies on `/pr` for dirty state. |
| [`3211510381`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211510381) | §4.3 Invocation, §4.3 Steps | Accept | `/ship [PR#\|URL]` supported; branch-switch safely. |
| [`3211516014`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211516014) | §4.3 Steps, §4.3 Failure modes | Accept | "Anything not green blocks merge." |
| [`3211523650`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211523650) | §4.2 Steps, §4.3 Steps | Accept (Item 24 retired into Item 21) | Branch must be current; file-overlap optimization is moot under up-to-date branch protection. |
| [`3211534869`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211534869) | §4.3 Steps | Accept | Confirm only when `/ship` created the PR this run. |
| [`3211537639`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211537639) | §4.3 Invocation, §4.3 Steps | Superseded by repo policy | `/ship --squash` removed because PR #236 disables squash merges at the repo level. |
| [`3211544467`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211544467) | §4.3 Steps | Accept | Post-merge watch on `main` for 5 minutes. |
| [`3211549081`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211549081) | §4.3 Steps, §4.3 Failure modes | Accept | No "Proceed" option. |
| [`3211556445`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3211556445) | §1, §3, §4 | Accept | Full simplification pass. |
| [`3277828039`](https://github.com/Intentional-Society/is-app/pull/133#discussion_r3277828039) | §4.2 Steps | Accept (post-ledger) | Fetch first; rebase by default; "restarts CI" was a red herring. |
| [`pullrequestreview-4249527087`](https://github.com/Intentional-Society/is-app/pull/133#pullrequestreview-4249527087) | §1, §3, §4 (P0.22) | Accept | "Fight complexity and scope creep" is the organizing principle. |

## Appendix B: Scenario walkthroughs

**B.1 — Happy path: `/ship "fix profile lookup"` from a dirty `main`.**

User invokes `/ship "fix profile lookup"` while on `main` with uncommitted changes. `/ship` delegates to `/pr`, which delegates to `/commit "fix profile lookup"`. `/commit` parses the context, auto-creates branch `fix-profile-lookup`, runs the suspicious-file blocker check (clean), stages explicit paths, verifies the staged set is non-empty, runs `npm test` (pass), drafts the commit message with `Summary: Fix profile lookup returning undefined for unauthenticated users.` plus `Why:` / `Behavior:` / `Test Plan:` sections, appends the `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` trailer, shows the bundled approval block (message + staged payload + no devjournal since this is a bugfix), human approves, commits, verifies no stray changes, pushes. `/pr` resumes: fetches `origin/main` (no-op for a fresh branch), drafts the PR title (`Fix profile lookup returning undefined for unauthenticated users`) and body for human approval, runs `gh pr create`, prints the URL, stops. `/ship` resumes: waits for `Lint & Functional Tests` + E2E + CodeQL to turn green (3 minutes), recognizes the PR was created during this run, prompts the merge confirmation Y/n, runs `gh pr merge --merge --delete-branch`, tidies (`git switch main && git pull --ff-only && git branch -d fix-profile-lookup`), captures merge SHA, runs `gh run list --branch main --commit <sha>` and `gh run watch <id>` for up to 5 minutes. Within 90 seconds: Vercel production deploy ✓, post-deploy e2e ✓. Reports merge SHA + Vercel production URL + "main: green."

**B.2 — Supervised handoff: `/ship` with E2E pending past the wait window, then green.**

User invokes `/ship` on a PR they opened earlier (PR pre-exists at invocation). `gh auth status` passes. `/ship` fetches `origin/main`, finds branch is current via `merge-base --is-ancestor`, skips rebase. No schema expand pending. Waits for CI: `Lint & Functional Tests` green within 1 minute; E2E still pending after the 5-minute wait window. `/ship` presents three options: `wait+5`, `troubleshoot`, `abort`. No `proceed` option. Human picks `wait+5`. E2E goes green within the next 3 minutes. `/ship` continues without an additional confirmation (the PR pre-existed at invocation, so the invocation itself was the merge confirmation), runs `gh pr merge --merge --delete-branch`, tidies, captures merge SHA, runs the post-merge watch (all green within 2 minutes). Reports merge SHA + Vercel production URL + "main: green."

**B.3 — Docs-only PR.**

User invokes `/ship` on a PR whose diff is confined to `docs/**` and root `CLAUDE.md`. `/ship` recognizes the docs-only condition. `ci.yml`'s `dorny/paths-filter` step detects the docs-only diff, skips the test steps, and still posts the `Lint & Functional Tests` status as green within seconds. Vercel preview is skipped per `vercel.json`'s `ignoreCommand`, so no preview `deployment_status` event fires and preview `e2e.yml` does not run. `/ship` treats the absent pre-merge advisory checks as expected per `docs/doc-github.md`'s docs-only rule, proceeds on required-green, runs `gh pr merge --merge --delete-branch`, tidies, then runs the post-merge watch. Production builds still run on `main`, including docs-only merges; if the production deploy or production `e2e.yml` run appears, `/ship` reports its result per §4.3. Reports merge SHA + post-merge status.

## Appendix C: Sources

1. **PR #133 review (James Baker)** — review comments linked individually from Appendix A.
2. **Anthropic Claude Code Skills** — `code.claude.com/docs/en/skills`; `skill-creator/SKILL.md` (the local skill-creator skill — workflow for building, evaluating, and description-optimizing Skills).
3. **Repo gates and CI** — `CLAUDE.md`, `package.json`, `.github/workflows/ci.yml` (single workflow with `dorny/paths-filter` for docs-only handling), `.github/workflows/e2e.yml`, `.github/workflows/forward-migrate-prod-schema-expansion.yml`.
4. **Repo policy docs** — `docs/strategy-committing.md` (commit format, expand-contract phase rules, AI co-author trailer), `docs/strategy-branching.md`, `docs/doc-github.md` (docs-only rule, advisory checks), `docs/strategy-project-management.md` (project-board automation).
5. **Repo config and policy enforcement** — `vercel.json` (docs-only ignore), `scripts/update-main-branch-protection.mjs` (required check name; `strict_required_status_checks_policy: true`); [PR #236](https://github.com/Intentional-Society/is-app/pull/236) for merge-method and branch-protection ruleset; [PR #254](https://github.com/Intentional-Society/is-app/pull/254) for the no-shallow-fetch lesson.
