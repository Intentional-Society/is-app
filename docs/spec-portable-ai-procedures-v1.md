# Portable AI Procedure Framework — Feature Spec

> Tracks [issue #62](https://github.com/Intentional-Society/is-app/issues/62). Synthesizes and supersedes `docs/plan-portable-ai-procedures.md` and `docs/plan-ai-checkin-procedure.md` for design-decision purposes (those remain as reference artifacts).
>
> Last verified against repo realities: 2026-05-06.
> Authored 2026-05-06 by Blake Pusztai with Claude Opus 4.7.

## Problem statement

Team members using AI coding assistants follow our team check-in conventions only as well as their personal "training" of that assistant — through prompting, custom memories, and tribal knowledge of which docs to read. The result is inconsistent execution of the same checkin process across the team, with each new teammate or assistant rebuilding muscle memory from zero. We are also a small team (4-5 part-time, including a couple of volunteers); losing per-person prompting/memory effort at every join or tool-switch is a real cost.

James captured the underlying hypothesis in [issue #62](https://github.com/Intentional-Society/is-app/issues/62#issuecomment-4320013457): we should be able to encode reliable process-execution instructions for AIs that transfer across the team. His stated "I'm done" workflow ([issue #62](https://github.com/Intentional-Society/is-app/issues/62#issuecomment-4374728362)) — *test + commit + make PR + watch + merge + tidy* — is the canonical acceptance behavior for `/ship`.

## Goals

- Provide one canonical, repo-resident source of truth for the AI-assisted `/commit`, `/pr`, and `/ship` check-in workflows.
- Make the workflow followable by any supported agent without private per-user prompting, memory, or teammate-specific training.
- Optimize implementation first for Claude Code, then Codex; provide first-class command/invocation UX where each tool supports it, with GitHub Copilot designed now and implemented after adapter verification.
- Keep procedure behavior portable even when trigger mechanics differ across assistants.
- Preserve existing repo policies around branching, tests, CI, docs sync, devjournal entries, GitHub project automation, and schema-change safety.
- Allow future assistants such as Cursor or Aider to be added as thin adapter layers without rewriting the canonical procedures.
- Keep the framework understandable and maintainable by a small, 4-5 person part-time team without dedicated tooling ownership.
- Make future procedure and assistant additions discoverable with minimal token waste.

## Non-goals

- No replacement for human PR review.
- No custom CLI, command runner, or CI job that runs an AI agent.
- No new cross-tool autonomous code review system. Existing CI remains the shared gate; assistant-specific review or security-review commands, where available, remain orthogonal.
- No new database migration system.
- No new test coverage infrastructure.
- No replacement or duplication of GitHub project-board automation.
- No generalized skills marketplace or repository governance framework.
- No first-class helper commands such as `/journal`, `/migrate`, `/rollback`, or `/revert` in v1.
- No implementation-grade adapters or procedure docs for Cursor, Aider, or other future assistants beyond Claude Code, Codex, and the Copilot design target.
- No web-side or GUI agent surface.
- No guarantee of identical UX across assistants. The goal is equivalent procedure behavior, not identical trigger mechanics.

## Constraints and trade-offs we accept

These are the real-world constraints the design is shaped against. (Distilled from `plan-ai-checkin-procedure.md`'s "Constraints we discovered" plus our own platform research.)

- **No uniform slash-command abstraction across assistants.** Claude Code has first-class slash commands at `.claude/commands/*.md`. Codex CLI's `~/.codex/prompts/` is user-local (not repo-shareable); the portable repo-shared mechanism in Codex is **Codex Skills**. Copilot's `.github/prompts/` works only in VS Code, Visual Studio, and JetBrains IDEs. The **portable artifact has to be the procedure doc**; per-tool slash UX is surfacing.
- **GitHub access is uneven across agents.** Some agents have `gh` CLI, some have GitHub MCP, some have neither. Procedures must be written to work with whatever GitHub access the agent has, and to stop-and-ask cleanly when none is available.
- **Hooks tempt us but aren't portable.** A Claude Code `PreToolUse` hook on `Bash(git commit*)` would enforce the gate cleanly, but it's Claude-only and CLI-only. Hooks may be added later as belt-and-suspenders enforcement, but the procedure must stand on its own.
- **Aider has its own opinionated `/commit` and auto-commits by default.** Trying to override it isn't worth v1 effort. Aider users can read the procedure docs by hand; first-class shim deferred.
- **GitHub Copilot's coding agent runs server-side on PRs**, not on a developer's checkout. Different mental model from CLI assistants. v1 design supports it via AGENTS.md (no slash UX needed); IDE Chat gets the slash UX through `.github/prompts/`.
- **`npm test` includes Playwright e2e** (slow, flaky, port 3093). The pre-commit gate must not run the full suite — `lint + typecheck + test:functional` is the right local gate, matching what CI's required check covers anyway. **This contradicts current `CLAUDE.md`** ("Run `npm test` before committing"); resolved by editing CLAUDE.md in Phase 1.
- **Existing `/review` and `/security-review` skills already work as Claude Code slash commands.** The procedure should *compose* with them ("for security-touching changes, run `/security-review` before `/ship`"), not absorb them.
- **Claude Code does not yet read AGENTS.md natively** as of May 2026. We accept dual-maintenance of `CLAUDE.md` and `AGENTS.md` for now; collapse to a single index when Anthropic ships AGENTS.md support.
- **Tiny team context.** A 4-5 person part-time team — including volunteers — can't afford procedure-doc tooling that requires dedicated ownership. v1 prefers the lightest durable pattern; CI lint, multi-tier procedure file structures, observability hooks are all deferred.

## Design principles

- **Procedure first, trigger second:** the durable artifact is the procedure doc; assistant-specific files are adapters.
- **Claude-first adoption, portable architecture:** optimize the first implementation path for Claude Code without making the procedures Claude-only.
- **Single maintenance path:** keep the real `/commit`, `/pr`, and `/ship` workflow instructions in canonical procedure docs. Claude, Codex, and Copilot files should only point to those docs and explain how that assistant invokes them.
- **Use official extension points:** prefer documented repo instructions and Agent Skills over custom conventions.
- **Keep always-on context small:** root instruction files should index procedures, not inline them.
- **Drift-aware documentation:** make procedure dependencies visible at natural edit points. Canonical procedure docs should link to the repo policy docs they depend on, and high-impact policy docs should point back to the relevant AI procedures. Use `Last verified` dates for external platform assumptions, not for every internal repo reference.
- **Fail safe:** stop loudly on uncertain or risky states rather than force, bypass, or guess. Never use `--no-verify`, silently skip expected checks, silently merge through advisory failures, or hide uncertainty; report the blocking state and hand control back to the human.
- **Human confirmation where judgment matters:** commit text, PR text, AI attribution, advisory check failures, and ambiguous working-tree states require explicit review.
- **Small-team durability:** choose boring markdown files and existing `git`/`gh` workflows over sophisticated automation.

## Validated tool/platform assumptions

(Verified against May 2026 docs; sources at end.)

- **Claude Code** has first-class slash commands at `.claude/commands/<name>.md`. Frontmatter supports `description`, `allowed-tools`, `argument-hint`, `model`, `disable-model-invocation`. Reads `CLAUDE.md` at session start. **Does not natively read `AGENTS.md` as of May 2026** (open feature request).
- **Codex CLI** reads `AGENTS.md` natively from project root (and nested AGENTS.md per directory; precedence: per-directory > project root > global). Custom slash commands at `~/.codex/prompts/` are **user-local and not repo-shareable** (top-level Markdown only). The repo-shareable, implicitly-invokable mechanism is **Codex Skills** at `.codex/skills/<name>/SKILL.md`.
- **GitHub Copilot** has multiple surfaces:
  - **Coding agent** (server-side, fires from PRs/issues) reads `AGENTS.md` natively (Aug 2025 GA), plus `.github/copilot-instructions.md`, `.github/instructions/**.instructions.md`, plus also reads `CLAUDE.md` and `GEMINI.md`.
  - **Copilot Chat in IDE** uses `.github/prompts/<name>.prompt.md` invokable as `/<name>` — VS Code, Visual Studio, JetBrains only.
  - **Copilot CLI** has separate custom-instruction mechanism; not addressed in v1.
- **AGENTS.md** is the cross-tool standard (Linux Foundation Agentic AI Foundation, Dec 2025). Adopters: Codex CLI, Copilot, Cursor, Windsurf, Aider, Zed, Warp, RooCode, Amp, Devin, Gemini CLI. Notable holdout: Claude Code (uses `CLAUDE.md`).
- **Repo realities** (verified):
  - Required CI status check: `Lint & Functional Tests` (`ci.yml` for code PRs; `ci-docs-skip.yml` no-op for docs-only PRs). Both report under the same status name, so docs-only PRs go green within seconds with no special-casing.
  - Advisory checks: CodeQL, E2E (against Vercel preview, fires on `deployment_status`).
  - Branch protection ruleset is managed in `scripts/update-main-branch-protection.mjs`.
  - Project board automation: `PR Linked → In progress`, `PR Merged → Done` (per `docs/doc-strategy-project-management.md`). `Closes #N` linkage triggers it.
  - `vercel.json` `ignoreCommand` already skips preview builds for docs-only branch diffs.
  - `package.json`'s `npm test` runs lint + typecheck + functional + e2e (the slow flaky full suite). Repo `CLAUDE.md` currently says "run `npm test` before committing" — must be reconciled with the procedure-doc guidance.

## Proposed architecture

### Files: new vs existing

The v1 work splits cleanly into new files, edits to existing files, and existing files that stay as-is. Crucial principle: **strategy docs are policy/rationale for humans; procedure docs are imperative step-by-step for agents.** Procedure docs *reference* strategy docs; they never duplicate them.

| File / folder | Status | Role |
|---|---|---|
| `docs/procedures/{commit,pr,ship}.md` | **NEW** | Imperative step-by-step for agents — single source of truth for procedure logic |
| `AGENTS.md` (root) | **NEW** | Cross-tool index — short pointers to procedure docs + extension recipe |
| `.claude/commands/{commit,pr,ship}.md` | **NEW** | Claude Code slash-command shims |
| `.codex/skills/{commit,pr,ship}/SKILL.md` | **NEW** | Codex Skill shims (implicit invocation) |
| `.github/copilot-instructions.md` | **NEW** | Copilot index pointing at AGENTS.md |
| `.github/prompts/{commit,pr,ship}.prompt.md` | **NEW** | Copilot Chat IDE prompt files |
| `CLAUDE.md` (root) | **EDIT** | Add pointer to AGENTS.md and procedure docs; reconcile pre-commit gate from `npm test` to lint+typecheck+functional; add Maintenance section |
| `docs/doc-strategy-committing.md` | **EDIT** | Add new "Conventions" section (currently emergent in `git log` only); expand AI-trailer subsection covering both commit and PR-body trailer |
| `docs/doc-strategy-branching.md` | **stays as-is** | Branching rationale; procedure docs reference for branch naming rules |
| `docs/doc-strategy-project-management.md` | **stays as-is** | Project board policy; procedure docs reference for `Closes #N` automation |
| `docs/doc-github.md` | **stays as-is** | Branch protection / CI workflow reference; procedure docs reference for required-vs-advisory checks |
| `package.json`, `.github/workflows/*.yml`, `scripts/update-main-branch-protection.mjs`, `vercel.json` | **EDIT (one-line comments)** | Inverse pointers: "if you change this, also check `docs/procedures/`" — drift detection (P0.17) |
| `README.md` | **EDIT** | Add a short "Working with AI assistants" section pointing at procedure docs |

### File layout

```
docs/procedures/
  commit.md              # canonical commit procedure (single source of truth)
  pr.md                  # canonical PR-open + watch procedure
  ship.md                # canonical headline workflow:
                         # commit → push → pr → watch → merge → tidy

AGENTS.md                # cross-tool index — short, points at procedure docs
CLAUDE.md                # already exists — adds pointer to AGENTS.md and procedure docs

.claude/commands/
  commit.md              # 3-line shim → docs/procedures/commit.md
  pr.md                  # 3-line shim → docs/procedures/pr.md
  ship.md                # 3-line shim → docs/procedures/ship.md

.codex/skills/
  commit/SKILL.md        # Codex Skill — implicit-invoke on "commit this" intents
  pr/SKILL.md            # Codex Skill — implicit-invoke on "open a pr" intents
  ship/SKILL.md          # Codex Skill — implicit-invoke on "ship/merge/finish" intents

.github/
  copilot-instructions.md  # short pointer at AGENTS.md
  prompts/
    commit.prompt.md     # 3-line shim — Copilot Chat IDE only
    pr.prompt.md         # 3-line shim — Copilot Chat IDE only
    ship.prompt.md       # 3-line shim — Copilot Chat IDE only
```

### Why this layout

- `docs/procedures/{commit,pr,ship}.md` are the **only** files that contain procedure logic. Every per-tool shim points at them. This is the portability claim made literal.
- `AGENTS.md` at the root is the cross-tool index — Codex, Copilot, Cursor, etc. read it directly. Three short pointers + an extension recipe at the bottom. Not duplicated procedure content.
- `CLAUDE.md` stays as Claude's index because Claude Code does not yet read AGENTS.md; it gets a small "for commit/PR/ship work, see `docs/procedures/`" addition and a forward-compat pointer to AGENTS.md. When Claude Code ships AGENTS.md support, CLAUDE.md collapses to a short pointer.
- `.claude/commands/` shims provide `/commit`, `/pr`, `/ship` slash UX in Claude Code.
- `.codex/skills/<name>/SKILL.md` provides the **repo-shared** Codex equivalent. Codex Skills implicitly invoke on natural-language matches and can be invoked explicitly with `$<name>`. This is the actual portable Codex pattern in 2026; user-local `~/.codex/prompts/` is not.
- `.github/copilot-instructions.md` is the Copilot index. Says "follow `AGENTS.md`." Covers both the coding agent and IDE Chat without duplication.
- `.github/prompts/<name>.prompt.md` adds slash UX for IDE Chat users (VS Code, Visual Studio, JetBrains). Other Copilot surfaces (CLI, web coding agent) reach the procedures via AGENTS.md.

## Command/procedure scope

### Three commands

| Command | Intent | Internal behavior |
|---|---|---|
| `/commit` | Make a single, well-formed local commit | Walk gates → propose message → human review → commit; stops at local commit. |
| `/pr` | Push current branch and ensure a PR exists in the right state | State-dispatcher; opens new PR or updates existing; stops after PR open + auto-merge prompt. |
| `/ship` | The full "I'm done" workflow | State-aware: from a clean branch, runs commit → push → /pr → watch CI → merge when green → tidy local branch. |

### Naming decision: `/ship`, not `/merge`, no aliases in v1

`/ship` wins over `/merge` because it captures James's stated workflow (test + commit + make PR + watch + merge + tidy), is intent-based rather than primitive-based, and composes naturally with the primitives: `/commit` → `/pr` → `/ship` walks low-to-high abstraction.

We do not ship a `/merge` alias in v1 (synonym proliferation is overhead in a small team; an alias is a 3-line addition if dogfooding asks for it).

We do not ship a `/pr --ship` flag (the state-aware `/ship` command makes the chained-flag glue redundant).

### State dispatch — plain English

All three commands inspect repo state and pick the right next action. The shape:

For **`/commit`**: branch != main, diff non-empty, gates pass → commit. Otherwise refuse with a clear reason.

For **`/pr`**:
- HEAD is `main` → refuse.
- Working tree dirty + commits exist → ask: include uncommitted in this PR (run `/commit`), stash, or proceed with existing commits.
- Working tree dirty + no commits → narrate "no commits yet — running `/commit` first" and continue.
- Clean tree + commits exist + no open PR → run **Open procedure**.
- Clean tree + open PR exists → push new commits to existing PR (state report; auto-merge state, if previously set, persists across pushes).
- Open PR + CI green + not merged → ask "merge now?".
- Open PR + advisory check failed → **Supervised-auto handoff** (proceed / abort / troubleshoot).
- PR merged → "already merged; tidy local branch?".

For **`/ship`**: same dispatch as `/pr`, but on "PR is green" the agent merges (not asks); after merge it tidies the local branch (`git branch -d <branch>` after confirming remote was deleted). On advisory failure, it does the same supervised-auto handoff `/pr` does.

### `/commit` — required step-by-step

1. **Branch check.** Refuse if HEAD is `main`.
2. **Diff scan.** `git diff` and `git diff --staged`. Abort if both empty (no-op commit).
3. **Doc-sync gate.** If touched files include schema, API shapes, or behavior covered in `CLAUDE.md` / `docs/`, prompt to update those before committing.
4. **Devjournal prompt.** If the change is teammate-relevant (heuristic: non-trivial code change, new dependency, behavior change, security-relevant), draft a `docs/devjournal.md` entry and ask the human to accept/edit/skip.
5. **Pre-commit gate.** Run `npm run lint`, `npm run typecheck`, `npm run test:functional`. All must pass. Do **not** run `npm test` (full suite includes flaky e2e).
6. **Coverage heuristic.** For each `src/**` file in the diff, look for matching changes under `tests/` or a sibling `*.test.*` file. Classify the change type (new endpoint / bugfix / refactor / UI / docs / config) and surface gaps as questions, not refusals — the human picks from {refactor with existing coverage / pure UI tweak / regression test not possible because X / forgot}. **Bugfix exception**: a bugfix (commit subject starts with `Fix:` or PR closes a bug-tagged issue) without a regression test is a near-blocker — require explicit acknowledgement before continuing.
7. **Schema-touch detection.** If `src/server/schema.ts` or anything under `drizzle/` is in the diff, surface what the generated migration SQL touches as a heads-up and confirm the expand-contract phase with the human. The strategy doc (`doc-strategy-committing.md`) owns per-phase verification rules — the procedure inherits them rather than re-deriving. Refuse to bundle expand and contract phases in the same PR (existing rule: "Each phase is its own PR and deploy. Never combine expand and contract in a single deploy").
8. **Issue lookup.** If the human named an issue, `gh issue view <N>` to confirm it exists and is open.
9. **Secret scan.** Reject diffs containing `.env*` files, lines matching common key patterns, or files larger than a sane threshold.
10. **Commit message draft.** Use the repo's recent style (`git log --oneline -20 origin/main`). Structure: subject under 70 chars, then `Why:` / `Behavior:` / `Test Plan:` body, then `Closes #N` if applicable. **Test-plan provenance rule**: every line is either (a) a command the agent ran with captured output, (b) a verbatim human attestation, or (c) a single collapsed line for "ran lint + typecheck + functional locally". Never invented. Show the draft to the human before committing.
11. **Co-author trailer.** Default to including `Co-Authored-By:` with model specificity when the agent ran `/commit`; ask once per session to confirm and cache the answer.
12. **Stage explicitly.** `git add <files>` — never `git add -A` or `git add .`.
13. **Commit.** Pass message via heredoc. If a hook fails, fix and create a **new** commit; never `--amend` after a hook failure.
14. **Stop.** Don't push. Output: commit SHA + suggestion to run `/pr` or `/ship` when ready.

### `/pr` — required structure

`/pr` is a single command that does the right next thing for the current branch's PR state. When the working tree isn't in the happy state, the agent evaluates with a "do no harm" lens and continues the natural next step rather than refusing and forcing the human to retype. Auto-invoking `/commit` is *not* silent action — `/commit`'s message-draft step is itself a human-review checkpoint.

**Working-tree gate** (runs first, regardless of which sub-procedure follows). Inspect `W = git status --porcelain` and `C = git log origin/main..HEAD`. Dispatch on the four-quadrant outcome:
- **W empty, C empty** — branch is identical to `main`. Refuse; nothing to PR.
- **W non-empty, C empty** — no commits yet. Announce ("no commits on this branch — running `/commit` first, then opening the PR") and flow into it. Human still reviews the commit message before it is written.
- **W non-empty, C non-empty** — ambiguous. Stop and ask: "you have `<N>` existing commits plus uncommitted work in `<files>`. Should the new work be part of this PR (commit it first), set aside (stash it), or shipped later (proceed with just existing commits)?" Don't pick silently.
- **W empty, C non-empty** — happy path. Continue to the sub-procedure the dispatcher selected.
- **HEAD is `main`** — refuse regardless of W/C; no safe auto-fix.

**Open procedure** (state: clean tree, commits exist, no open PR).
1. Re-run `npm run lint`, `npm run typecheck`, `npm run test:functional`. Cheap re-confirm in case the human moved files around.
2. **Branch-freshness check.** `git fetch origin main && git log origin/main..HEAD`. If branch is behind `main`, ask whether to rebase before pushing.
3. **Push.** `git push -u origin <branch>`.
4. **PR title + body draft.** Title under 70 chars. Body: Context / What changed / Why / Test Plan / `Closes #N`. Test-plan provenance rule applies. Co-Authored-By trailer appended to PR body when the agent opens it (P0.16). Draft to chat for human review before posting.
5. **Open PR.** `gh pr create` with the approved body.
6. **Auto-merge prompt.** Ask "enable auto-merge once required checks pass? [Y/n]". Defaults flip on change classification:
   - **Default Y** — code-only PRs.
   - **Default N** — schema-touching PRs (per `doc-strategy-committing.md`, expand-contract phasing requires phase-aware verification the agent can't fully automate).
   - **Default N** — security-touching changes (auth, headers, secret handling).
   - On Y: `gh pr merge --auto --merge` (merge-commit strategy preserves per-commit Why/Test Plan structure).
7. Print PR URL. Stop, but stay available — if advisory checks fail, re-engage via the supervised-auto handoff.

**Update-existing-PR path** (state: clean tree, commits exist, open PR exists).
The dispatcher routes here when the human has just pushed new commits to an already-open PR.
- Skip the title/body draft.
- Push the new commits to the existing branch (`git push`).
- Note in chat: "Pushed `<SHA>` to existing PR #<N>. Watch CI."
- Auto-merge state, if previously set, persists across pushes — no need to re-prompt.

**Merge procedure** (runs when the dispatcher hits "CI green, not merged" and the human says merge, or when called explicitly via `/pr merge`).
1. **Required check status.** `gh pr checks <N>`. The required check (`Lint & Functional Tests`) must be green; refuse otherwise.
2. **Advisory check status.** If CodeQL or E2E is red, run **Supervised-auto handoff**.
3. **Branch-freshness.** If the PR is behind `main`, ask whether to rebase + re-push (which restarts CI) or hand off.
4. **Merge.** `gh pr merge <N> --merge`.
5. **Post-merge confirmation.** Report the merge SHA and link to Vercel's deploy status.

**Supervised-auto handoff** (runs when an advisory check fails).
The agent does not silently merge through it and does not silently abort. It surfaces the failure with three options and stays in the conversation:
1. **Proceed.** Merge despite the advisory failure (human takes responsibility).
2. **Abort.** Don't merge; clear the auto-merge flag if set; treat the advisory as a real signal.
3. **Troubleshoot together.** Walk the failure with the agent — read the CodeQL alert / inspect the failing E2E test / draft a fix. Once resolved, the merge can proceed via the same `/pr` invocation.

This keeps the agent in the loop where it adds value (helping resolve), not just at the bookend.

### `/ship` — required structure

1. Run the same Working-tree gate and state dispatcher as `/pr`.
2. From clean + commits + no PR: run the **Open procedure**, then watch CI (`gh pr checks --watch` or polling).
3. From open PR + CI in progress: watch.
4. From open PR + CI green: run **Merge procedure** (no "merge now?" ask — `/ship` implies the merge intent).
5. After merge: report merge SHA + Vercel deploy URL; tidy local branch (`git branch -d <branch>` after confirming remote was deleted by GitHub).
6. Advisory failures: same **Supervised-auto handoff** as `/pr`.

The only behavioral differences vs `/pr`: (a) `/ship` does not ask "merge now?" once CI is green — it merges; (b) `/ship` performs the local-branch tidy step after merge.

## Detailed requirements

### P0 — required for v1

- **P0.1 — Single-source-of-truth procedure docs.** `docs/procedures/{commit,pr,ship}.md` are the only files containing procedure logic.
- **P0.2 — Cross-tool index files.** `AGENTS.md` and `CLAUDE.md` exist at root; both are short and point at the procedure docs.
- **P0.3 — Claude Code shims.** `.claude/commands/{commit,pr,ship}.md`. Each ≤5 lines.
- **P0.4 — Codex Skills shims.** `.codex/skills/{commit,pr,ship}/SKILL.md` for implicit-invoke + explicit `$<name>`. Each SKILL.md ≤10 lines (description + body that loads the procedure doc).
- **P0.5 — GitHub Copilot integration.** `.github/copilot-instructions.md` (≤5 lines, points at AGENTS.md). `.github/prompts/{commit,pr,ship}.prompt.md` (≤5 lines each) for IDE Chat slash UX. Coding agent and other surfaces inherit via AGENTS.md.
- **P0.6 — Conventions encoded in `doc-strategy-committing.md`.** New "Conventions" section captures branch naming (kebab-case, ~3-5 words, optional `docs/` prefix), commit message format (imperative, ≤70 char subject, no trailing period), PR title (same shape), PR description structure (Context / What / Why / Test Plan / `Closes #N`), issue-linkage rules, merge style (`--merge` default, squash by exception only). Procedure docs reference this section rather than duplicating it.
- **P0.7 — AI-attribution trailer with model specificity (commit).** Lift the existing one-line rule in `doc-strategy-committing.md` into a clearer subsection with format spec and examples (Claude / Codex / Copilot forms — exact form per provider per OQ-1, OQ-2). Default behavior: include when the agent ran `/commit`; ask once per session to confirm.
- **P0.8 — State-aware dispatch on `/pr` and `/ship`.** Both inspect branch state and pick the right next action. Idempotent on re-run.
- **P0.9 — Pre-commit gate is lint + typecheck + functional, not full `npm test`.** Reflected in CLAUDE.md, which currently says otherwise. Updating CLAUDE.md is part of P0.
- **P0.10 — Schema-touch detection routes to expand-contract review.** Inline in commit.md and pr.md (no separate procedure doc in v1).
- **P0.11 — Devjournal nudge embedded in `/commit`.** Inline.
- **P0.12 — Supervised-auto handoff for advisory check failures.** Three options: proceed / abort / troubleshoot. Stays in conversation.
- **P0.13 — Failure handoff is loud.** No `--no-verify`, no force-push, no silent skip, no silent merge through advisory failure.
- **P0.14 — Compose with existing skills.** Procedure docs reference `/review` and `/security-review` as recommended composition points; do not absorb or duplicate.
- **P0.15 — `Closes #N` linkage.** When the human names an issue, the agent uses `Closes #N` in the PR body so the project-board automation transitions Done correctly (per `doc-strategy-project-management.md`).
- **P0.16 — PR-body Co-Authored-By trailer with model specificity.** When an AI assistant opens or updates a PR via `/pr` or `/ship`, append the same `Co-Authored-By:` trailer (P0.7 format) to the PR description body, not just the commit. Same model-specificity rule.
- **P0.17 — Drift-aware documentation.** Make procedure dependencies visible at natural edit points without per-doc staleness noise:
  - **Cross-reference footer** on each procedure doc listing the repo policy docs it depends on (`doc-strategy-committing.md`, `doc-strategy-branching.md`, `doc-github.md`, `doc-strategy-project-management.md`).
  - **Bidirectional back-link** on each high-impact policy doc — a short "Related AI procedures" section pointing at the procedure docs that consume its rules. So when someone edits `doc-strategy-committing.md` the back-link reminds them to check `docs/procedures/commit.md` and `docs/procedures/pr.md`.
  - **Inverse pointers** on the most volatile depended-on files (`package.json`, `.github/workflows/ci.yml`, `.github/workflows/ci-docs-skip.yml`, `.github/workflows/e2e.yml`, `scripts/update-main-branch-protection.mjs`, `vercel.json`): a one-line comment near the top — *"If you change this, also check `docs/procedures/`."*
  - **Maintenance section** in `AGENTS.md` and `CLAUDE.md` listing the touch-trigger files explicitly.
  - **`Last verified` dates scoped to external platform assumptions only** — e.g., the "Validated tool/platform assumptions" section of this spec and of AGENTS.md (Claude Code AGENTS.md status, Codex Skills behavior, Copilot prompt-file scope). **Not** on every procedure doc — internal repo references stay fresh through the bidirectional-link mechanism above.
  - **PR-template checklist item** that fires when `docs/procedures/**` is touched: "smoke-tested end-to-end with at least one assistant?". Lightweight version of the deferred CI lint.

### Out of scope for v1 (deferred to v1.1+ or later)

- First-class `/journal`, `/migrate` commands as separate triggerable shims. Their behaviors live inside `/commit` for v1; promoting them later is purely additive.
- `procedures/devjournal.md` and `procedures/migrate.md` as separate files (inlined in commit.md for v1).
- Procedure-doc CI lint that asserts every procedure doc has the required sections and that referenced strategy-doc anchors still exist. With three procedure docs and a 4-5 person team, the regression it catches (silent drift) is hypothetical; the lighter v1 alternative ships in P0.17. Promote to real CI lint when there are 5+ procedure docs or when an actual drift regression bites.
- Per-procedure observability (Axiom hooks).
- Per-tool shims for Cursor / Aider / other assistants beyond the named three.
- Aider-specific design (Aider's opinionated `/commit` auto-commits by default; not worth fighting in v1).
- Docs-only-skip awareness in `/pr` (unnecessary — `ci-docs-skip.yml` already reports the same status name within seconds).

> **Note**: "Generated CI step that runs the agent on a draft PR (`claude -p`, `codex exec`)" is a **non-goal** of this spec (permanent boundary, not deferred work).

## Guardrails and edge cases

- **Refuse on `main`.** No commits, no pushes, no PR-open from `main`.
- **Working-tree gate.** The W × C four-quadrant outcome (uncommitted × commits ahead of main).
- **Branch-freshness check.** On `/pr` and `/ship`, fetch `origin/main` and warn if branch is behind. Ask before rebasing.
- **Required check vs advisory.** Only `Lint & Functional Tests` is required. Advisory failures (CodeQL, E2E) trigger supervised-auto handoff, not silent merge.
- **Stage explicitly.** `git add <files>`, never `-A`.
- **Hook failure → new commit, not `--amend`.** Preserves audit trail.
- **Bugfix without regression test.** Near-blocker; require explicit acknowledgement.
- **Schema change without expand-contract.** Refuse to bundle expand+contract in one PR. Procedural enforcement of an existing rule: `doc-strategy-committing.md` already states *"Each phase is its own PR and deploy. Never combine expand and contract in a single deploy — that's the window where things break."*
- **Secret scan.** Reject `.env*`, key-pattern matches, oversized files.
- **Test-plan provenance.** Lines must be (a) commands the agent ran, (b) verbatim human attestations, or (c) one collapsed line for "ran lint + functional locally". Never invented.
- **Co-author trailer.** Default include when agent ran `/commit`; ask once per session to confirm.
- **Auto-merge default.** Y for code-only PRs; N for schema-touching or security-touching PRs (auth, headers, secret handling). On Y: `gh pr merge --auto --merge`. *Source:* `plan-ai-checkin-procedure.md` (which derives the schema/security N defaults from `doc-strategy-committing.md`'s expand-contract phasing).
- **Merge strategy.** `--merge` (merge commit) preserves per-commit structure; squash only by explicit flag.

## Documentation and source-of-truth model

- **`docs/procedures/<name>.md`** = single source of truth for procedure logic. Every per-tool entrypoint references these.
- **`doc-strategy-committing.md` Conventions section** = single source of truth for branch/commit/PR/merge format rules. Procedure docs reference, never restate.
- **`AGENTS.md`** = cross-tool index. Short. Three pointers + an extension recipe ("to add a new procedure: write `docs/procedures/<name>.md` and add 3-line shims under `.claude/commands/`, `.codex/skills/<name>/SKILL.md`, and `.github/prompts/<name>.prompt.md`") + a Maintenance section.
- **`CLAUDE.md`** = Claude Code's index. Adds a one-line pointer to AGENTS.md (forward-compat) and a section pointing at the procedure docs. When Claude Code ships AGENTS.md support, this collapses.
- **`.github/copilot-instructions.md`** = Copilot's index. Points at AGENTS.md.

### Discoverability

For humans: add a "Working with AI assistants" section to `README.md` with a one-paragraph summary and a link to `docs/procedures/`. A `CONTRIBUTING.md` is not needed in v1; revisit if the AI-procedure surface grows.

For agents: AGENTS.md and CLAUDE.md both list every procedure doc with a one-sentence "use when" pointer. Procedure doc filenames are predictable. The extension recipe is at the bottom of AGENTS.md.

### Drift detection

A procedure doc is only as good as the repo realities it claims to encode. v1 ships layered, edit-point-anchored safeguards (P0.17):

1. **Cross-reference footers** in each procedure doc, listing the policy docs it depends on.
2. **Bidirectional back-links** — high-impact policy docs (`doc-strategy-committing.md`, `doc-strategy-branching.md`, `doc-github.md`, `doc-strategy-project-management.md`) each get a "Related AI procedures" section pointing at the procedure docs that consume their rules.
3. **Inverse pointers** near the top of volatile depended-on files (`package.json`, CI workflows, branch-protection script, `vercel.json`): *"If you change this, also check `docs/procedures/`."*
4. **Maintenance section** in `AGENTS.md` and `CLAUDE.md` that lists touch-trigger files.
5. **`Last verified` dates** scoped to **external platform assumptions** in `AGENTS.md` and the spec — not on every procedure doc.
6. **PR-template checklist item** for `docs/procedures/**` edits.

Together these make it hard for a procedure doc to silently drift out of sync with repo behavior, without committing to a heavier CI-lint mechanism.

## Phased rollout recommendation

**Phase 1 — Framework + Claude (one PR).**
- `docs/procedures/{commit,pr,ship}.md` with cross-reference footers listing the policy docs they depend on (P0.17).
- `AGENTS.md` (root-level cross-tool index, with Maintenance section listing touch-trigger files and a `Last verified` date scoped to the external-platform-assumptions section).
- `CLAUDE.md` updates: pointer to AGENTS.md, pointer to procedure docs, fix the "run `npm test` before committing" line to reflect lint + typecheck + functional, add Maintenance section.
- `.claude/commands/{commit,pr,ship}.md` (Claude Code shims).
- `doc-strategy-committing.md`, `doc-strategy-branching.md`, `doc-github.md`, `doc-strategy-project-management.md` — each gets a short "Related AI procedures" back-link section (P0.17 bidirectional links).
- `doc-strategy-committing.md` also gets: new Conventions section, expanded AI-trailer subsection (now covering both commit and PR-body trailer per P0.16).
- One-line "if you change this, also check `docs/procedures/`" comment near the top of `package.json`, `.github/workflows/ci.yml`, `.github/workflows/ci-docs-skip.yml`, `.github/workflows/e2e.yml`, `scripts/update-main-branch-protection.mjs`, `vercel.json` (P0.17 inverse pointers).
- PR-template item that fires when `docs/procedures/**` is touched (P0.17).
- `README.md` mention.

Acceptance: dogfood for one week — every commit from at least one Claude Code user goes through `/commit` or `/ship`. Verify a Phase 1 PR carries the AI trailer in both the commit and the PR body.

**Phase 2 — Codex (separate PR).**
- `.codex/skills/{commit,pr,ship}/SKILL.md`.
- AGENTS.md updates (if any) for Codex-specific affordances discovered in implementation.

Acceptance: a Codex CLI user dogfoods one PR end-to-end via implicit-invoke skills.

**Phase 3 — Copilot (separate PR).**
- `.github/copilot-instructions.md`.
- `.github/prompts/{commit,pr,ship}.prompt.md`.

Acceptance: a Copilot Chat IDE user dogfoods one PR end-to-end. The Copilot coding agent inherits via AGENTS.md (validated by triggering one issue-to-PR run).

**Phase 4 (deferred / opportunistic).**
- First-class `/journal`, `/migrate` shims.
- Procedure-doc CI lint (full version; the lighter `Last verified` + cross-reference + PR-template-checklist version ships in Phase 1 as P0.17).
- Cursor / Aider shims.
- Coverage delta in CI.

### Why this phasing

- Phase 1 is load-bearing. If we get the procedure docs and Claude wiring right, every later phase is cheap.
- Phases 2 and 3 are non-breaking additions: no procedure rewrites, only new shim folders.
- Each phase is small enough to be reviewed by one teammate in one sitting.
- The CLAUDE.md `npm test` edit is bundled with Phase 1 because the procedure docs depend on it being consistent — having two contradictory sources of truth is the worst outcome.

## Acceptance criteria

For v1 to be considered shipped:

1. A Claude Code user in a fresh clone can run `/commit`, `/pr`, and `/ship` and produce **equivalent procedure behavior** (not necessarily identical UX) to a manually-executed checkin per `doc-strategy-committing.md`.
2. A Codex CLI user in a fresh clone can say "commit this" / "open a PR for this" / "ship this" and the agent invokes the corresponding Codex Skill, producing equivalent procedure behavior to the Claude path.
3. A Copilot Chat IDE user in a fresh clone can use the slash UX (`/commit`, `/pr`, `/ship`) and produce equivalent procedure behavior. Copilot CLI and other Copilot surfaces produce conformant output via AGENTS.md without slash UX.
4. A Copilot coding-agent run from an issue inherits the procedure via AGENTS.md (no slash UX, but procedure-conformant output).
5. A docs-only PR opened via `/pr` completes within seconds of CI's no-op job posting status (verifies the existing workflow handles it without special-casing).
6. CLAUDE.md, AGENTS.md, and `doc-strategy-committing.md` are internally consistent (no contradictory pre-commit gate guidance, no contradictory commit-message rules).
7. The procedure docs reference rather than restate `doc-strategy-committing.md`'s Conventions section, and each procedure doc has a cross-reference footer to its policy docs (P0.17).
8. The high-impact policy docs (`doc-strategy-committing.md`, `doc-strategy-branching.md`, `doc-github.md`, `doc-strategy-project-management.md`) each carry a "Related AI procedures" back-link section (P0.17 bidirectional links).
9. A change to a procedure doc is a normal PR (no special workflow needed); the PR-template checklist (P0.17) fires when `docs/procedures/**` is touched.
10. The repo dogfoods cleanly for one week per phase with no convention-drift PR comments.
11. AI-opened PRs carry the `Co-Authored-By:` trailer in both the commit and the PR body (P0.7 + P0.16).
12. **Human-in-the-loop enforcement** (per design principle): commit text, PR text, AI attribution, advisory check failures, and ambiguous working-tree states all require explicit human review before the agent proceeds.

## Worked example — how PR #90 plays out under this spec

To validate the spec against real iteration, walk [PR #90](https://github.com/Intentional-Society/is-app/pull/90) (which added `--fix` to `check-env.mjs`, closing [#73](https://github.com/Intentional-Society/is-app/issues/73), with three commits: feature, CodeQL fix, wording polish):

- **Commit 1 (feature).** Human runs `/commit for #73`. Agent walks the gates, drafts the Why/Test Plan body, defaults to including the Co-Authored-By trailer (per P0.7), commits. `/ship` opens the PR with `Closes #73` and the same trailer in the PR body (P0.16). Auto-merge prompt defaults to **Y** (code-only PR); human accepts. Project board flips #73 to *In progress* via existing automation.
- **Commit 2 (CodeQL fix).** Human fixes the TOCTOU pattern; runs `/commit`. Agent re-verifies CI checks. `/pr` dispatches to the **Update-existing-PR path** and pushes — auto-merge state persists across pushes.
- **CodeQL re-run flips the advisory check.** While auto-merge is armed, the next push triggers CI again. CodeQL alert clears on the new commit; merge proceeds automatically once the required check is green.
- **Commit 3 (self-review polish).** Same iteration shape. Human runs `/review` first (existing skill) to surface wording issues; the procedure composes cleanly. Final push, auto-merge fires when CI is green.
- **If CodeQL had not cleared on commit 2's push**, the **Supervised-auto handoff** would have surfaced the failure with the three options instead of merging through it.

## Open questions

| ID | Question | Blocking | Why | Mitigation / options | Recommendation |
|---|---|---|---|---|---|
| **OQ-1** | What's GitHub Copilot's exact `Co-Authored-By:` form? Does it capture the underlying model (varies per user setting)? | **Blocks Phase 3 implementation** of `procedures/commit.md`. Not blocking for the spec itself or Phase 1. | Procedure must produce a verifiable, conformant trailer; Copilot's underlying model varies (GPT-4o, Claude, Gemini). | (a) Verify what GitHub itself documents and lift verbatim; (b) `Copilot (<model>) <noreply@github.com>` if model is detectable at agent runtime; (c) `Copilot <copilot@github.com>` if not. | Resolve during Phase 3 implementation. Phase 1 can ship with Claude's trailer alone. |
| **OQ-2** | What's OpenAI Codex's documented `Co-Authored-By:` form (assistant capitalization, version-string, noreply address)? | **Blocks Phase 2 implementation** of `procedures/commit.md` for Codex. Not blocking for the spec or Phase 1. | Same as OQ-1. | Verify in OpenAI Codex docs; lift verbatim. | Resolve during Phase 2 implementation. |
| **OQ-3** | Co-author detection policy: default-include when agent runs `/commit`, ask each time, or ask once per session? | **Blocks Phase 1 implementation**. Not blocking for the spec. | UX cost vs attribution accuracy trade-off. | (a) Default include — simplest, risks over-attribution when human did most work; (b) Ask each time — most accurate, friction; (c) Ask once per session, cache — middle ground. | Recommend (c). Ship Phase 1 with this default; revisit if dogfooding feedback says otherwise. |
| **OQ-4** | Should v1 also append the AI-attribution trailer to PR descriptions (`plan-portable` P0.6)? | **Resolved.** Promoted to P0.16 in v1. | Cost is ~5 lines in `procedures/pr.md`; benefit is real. | n/a | Include in v1 (P0.16), bundled into Phase 1. |
| **OQ-5** | When (and how) do we migrate `CLAUDE.md` → `AGENTS.md` once Claude Code ships AGENTS.md support? | Non-blocking. Future planning. | Currently Claude Code only reads CLAUDE.md; once it reads AGENTS.md, dual-maintenance is wasted effort. | (a) Watch the [Claude Code AGENTS.md issue](https://github.com/anthropics/claude-code/issues/6235); when it ships, collapse CLAUDE.md to a one-line pointer at AGENTS.md; (b) Move CLAUDE.md content into AGENTS.md and `@import` from CLAUDE.md. | Defer. Tracking link in AGENTS.md or CLAUDE.md is the watcher. Revisit when Anthropic ships support. |
| **OQ-6** | How do procedure-doc edits get tested? A bad commit to `procedures/commit.md` could silently break every teammate's `/commit`. | Non-blocking for v1 (P0.17 lighter alternative ships in Phase 1); blocking for full CI lint in Phase 4. | Risk of silent regression as procedure docs evolve. | (a) Trust dogfooding + P0.17 (`Last verified`, cross-reference, PR-template checklist) for v1; (b) Manual smoke-test checklist enforcement in CI; (c) Full `agents-smoke-test.yml` in Phase 4. | Ship (a) in v1. Promote to (c) when 5+ procedure docs exist or a regression bites. |
| **OQ-7** | E2E gating policy for `/ship`: block on red, warn-but-merge, or middle path (wait for completion, proceed regardless of result)? | **Blocking for `procedures/ship.md` content** in Phase 1. Not blocking for the spec architecture. | Branch protection requires only `Lint & Functional Tests`; e2e is advisory but flakes on cold start. | (a) Block on clean e2e (most conservative); (b) Match current habit (block only on required, surface e2e); (c) Middle path (wait up to N minutes for e2e to complete, proceed regardless of result). | Recommend (c) middle path as the working v1 default. Team's answer flips a one-line policy in `procedures/ship.md`; resolve on the Phase 1 PR. |
| **OQ-8** | Codex Skill scope: implicit invocation only, or both implicit + explicit `$<name>` trigger? | Non-blocking. Implementation detail. | Codex Skills support both. | (a) Both — `say "commit this"` OR `$commit`; (b) Implicit only, document explicit as an advanced affordance. | Recommend (a). Implicit is the default UX; explicit `$commit` is a fallback for "agent picked the wrong skill". |
| **OQ-9** | Should `CODEOWNERS` require a second-pair-of-eyes review on `docs/procedures/**`? | Non-blocking. Process choice. | Tiny team; CODEOWNERS may add friction without payoff. | (a) Add CODEOWNERS for `docs/procedures/**`; (b) Trust normal PR review. | Defer. Tiny team; trust normal PR review. Revisit if a regression bites. |

## Sources / verification

Used during spec authoring:

- Anthropic — [Claude Code slash commands docs](https://code.claude.com/docs/en/slash-commands)
- Anthropic — [Claude Code overview](https://code.claude.com/docs/en/overview)
- Anthropic — [Claude Code GitHub issue #6235 (AGENTS.md support)](https://github.com/anthropics/claude-code/issues/6235)
- OpenAI — [Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)
- OpenAI — [Codex CLI slash commands](https://developers.openai.com/codex/cli/slash-commands)
- OpenAI — [Codex custom prompts](https://developers.openai.com/codex/custom-prompts)
- OpenAI — [Codex Skills](https://developers.openai.com/codex/skills)
- OpenAI — [Codex CLI reference](https://developers.openai.com/codex/cli/reference)
- GitHub — [Copilot coding agent now supports AGENTS.md (Aug 2025 changelog)](https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/)
- GitHub — [Copilot prompt files docs](https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files)
- GitHub — [Copilot custom-instructions docs](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot)
- [agents.md cross-tool standard](https://agents.md/)
- Repo — `CLAUDE.md`, `docs/doc-strategy-committing.md`, `docs/doc-strategy-branching.md`, `docs/doc-github.md`, `docs/doc-strategy-project-management.md`, `.github/workflows/ci.yml`, `.github/workflows/ci-docs-skip.yml`, `.github/workflows/e2e.yml`, `vercel.json`, `package.json`.
- Issue thread — [#62](https://github.com/Intentional-Society/is-app/issues/62) and comments [4320013457](https://github.com/Intentional-Society/is-app/issues/62#issuecomment-4320013457), [4374728362](https://github.com/Intentional-Society/is-app/issues/62#issuecomment-4374728362).
- Reference drafts (preserved as input artifacts, superseded by this spec) — `docs/plan-ai-checkin-procedure.md`, `docs/plan-portable-ai-procedures.md`.
