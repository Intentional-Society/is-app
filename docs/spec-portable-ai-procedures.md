# Portable AI Procedure Framework — Feature Spec

> Tracks [issue #62](https://github.com/Intentional-Society/is-app/issues/62).
>
> **Last verified against repo realities:** 2026-05-06.
> Authored 2026-05-07 by Blake Pusztai with Claude Opus 4.7.

## 1. Overview

### Problem statement

Team members using AI coding assistants follow our team check-in conventions only as well as their personal "training" of that assistant — through prompting, custom memories, and tribal knowledge of which docs to read. The result is inconsistent execution of the same checkin process across the team, with each new teammate or assistant rebuilding muscle memory from zero. We are also a small team (4-5 part-time, including a couple of volunteers); losing per-person prompting/memory effort at every join or tool-switch is a real cost.

James captured the underlying hypothesis in [issue #62](https://github.com/Intentional-Society/is-app/issues/62#issuecomment-4320013457): we should be able to encode reliable process-execution instructions for AIs that transfer across the team. His stated "I'm done" workflow ([issue #62](https://github.com/Intentional-Society/is-app/issues/62#issuecomment-4374728362)) — *test + commit + make PR + watch + merge + tidy* — is the canonical acceptance behavior for `/ship`.

### Goals

- Provide one canonical, repo-resident source of truth for the AI-assisted `/commit`, `/pr`, and `/ship` check-in workflows.
- Make the workflow followable by any supported agent without private per-user prompting, memory, or teammate-specific training.
- Optimize implementation first for Claude Code, then Codex; provide first-class command/invocation UX where each tool supports it, with GitHub Copilot designed now and implemented after adapter verification.
- Keep procedure behavior portable even when trigger mechanics differ across assistants.
- Preserve existing repo policies around branching, tests, CI, docs sync, devjournal entries, GitHub project automation, and schema-change safety.
- Allow future assistants such as Cursor or Aider to be added as thin adapter layers without rewriting the canonical procedures.
- Keep the framework understandable and maintainable by a small, 4-5 person part-time team without dedicated tooling ownership.
- Make future procedure and assistant additions discoverable with minimal token waste.

### Non-goals

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

### Constraints and trade-offs we accept

These are the real-world constraints the design is shaped against.

- **No uniform slash-command abstraction across assistants.** Claude Code supports both first-class slash commands and Skills; Codex supports user-local prompts plus repo-shared Skills under `.agents/skills/`; Copilot's prompt files work only in VS Code / Visual Studio / JetBrains. The portable artifact has to be the procedure doc; per-tool slash UX is surfacing.
- **GitHub access is uneven across agents.** Some agents have `gh` CLI, some have GitHub MCP, some have neither. Procedures must be written to work with whatever GitHub access the agent has, and to stop-and-ask cleanly when none is available.
- **Hooks tempt us but aren't portable.** A Claude Code `PreToolUse` hook on `Bash(git commit*)` would enforce gates cleanly, but it's Claude-only and CLI-only. Hooks may be added later as belt-and-suspenders enforcement; the procedure must stand on its own.
- **Aider has its own `/commit` that auto-commits by default.** First-class shim deferred; Aider users can read the procedure docs by hand.
- **GitHub Copilot's coding agent runs server-side on PRs**, not on a developer's checkout. Different mental model from CLI assistants. v1 design supports it via AGENTS.md (no slash UX needed).
- **`npm test` includes Playwright e2e** (slow, can flake on cold start). The default pre-commit gate must not run the full suite — `lint + typecheck + test:functional` is the right local gate, matching what CI's required check covers anyway. The procedure escalates to full `npm test` only on user request or for high-risk/e2e-sensitive changes (see `/commit` step 5). **This contradicts current `CLAUDE.md`** ("Run `npm test` before committing"); resolved by editing CLAUDE.md in Phase 1a.
- **Existing `/review` and `/security-review` skills already work as Claude Code commands.** The procedure should *compose* with them ("for security-touching changes, run `/security-review` before `/ship`"), not absorb them.
- **Claude Code does not yet read AGENTS.md natively** as of May 2026. We accept dual-maintenance of `CLAUDE.md` and `AGENTS.md` for now; collapse to a single index when Anthropic ships AGENTS.md support.
- **Small-team context.** A 4-5 person part-time team — including volunteers — can't afford procedure-doc tooling that requires dedicated ownership. v1 prefers the lightest durable pattern.

### Design principles

- **Procedure first, trigger second:** the durable artifact is the procedure doc; assistant-specific files are adapters.
- **Claude-first adoption, portable architecture:** optimize the first implementation path for Claude Code without making the procedures Claude-only.
- **Single maintenance path:** keep the real `/commit`, `/pr`, and `/ship` workflow instructions in canonical procedure docs. Claude, Codex, and Copilot files should only point to those docs and explain how that assistant invokes them.
- **Use official extension points:** prefer documented repo instructions and Agent Skills over custom conventions.
- **Keep always-on context small:** root instruction files should index procedures, not inline them.
- **Drift-aware documentation:** make procedure dependencies visible at natural edit points. Canonical procedure docs link to the repo policy docs they depend on, and high-impact policy docs link back to the relevant AI procedures.
- **Fail safe:** stop loudly on uncertain or risky states rather than force, bypass, or guess. Never use `--no-verify`, silently skip expected checks, silently merge through advisory failures, or hide uncertainty; report the blocking state and hand control back to the human.
- **Human confirmation where judgment matters:** commit text, PR text, AI attribution, advisory check failures, ambiguous working-tree states, and PR merges all require explicit review.
- **Small-team durability:** choose boring markdown files and existing `git`/`gh` workflows over sophisticated automation.

## 2. Validated Context

### Validated tool/platform assumptions

> *Last verified: 2026-05-06.* Re-verify when updating assistant adapters or repo instruction files; do **not** re-verify during normal `/commit`, `/pr`, or `/ship` runs.

- **Claude Code** has first-class slash commands at `.claude/commands/<name>.md` and **Project Skills** at `.claude/skills/<name>/SKILL.md`. Skills are slash-invocable in Claude Code and additionally support implicit invocation by description. Reads `CLAUDE.md` at session start. **Does not natively read `AGENTS.md` as of May 2026.**
- **Codex CLI** reads `AGENTS.md` natively from project root (and nested AGENTS.md per directory; precedence: per-directory > project root > global). Custom slash commands at `~/.codex/prompts/` are user-local. **Repo-shared, implicitly-invokable skills live at `.agents/skills/<name>/SKILL.md`** — scanned from cwd up to repo root. (The `~/.codex/skills/` path holds user-level global skills, not repo-shared.)
- **GitHub Copilot** has multiple surfaces:
  - **Coding agent** (server-side, fires from PRs/issues): reads `AGENTS.md` natively (Aug 2025 GA), plus `.github/copilot-instructions.md`, `.github/instructions/**.instructions.md`, plus also reads `CLAUDE.md` and `GEMINI.md`.
  - **Copilot Chat in IDE** (VS Code, Visual Studio, JetBrains): supports Agent Skills from `.github/skills/`, `.claude/skills/`, and `.agents/skills/`. May obviate the need for a Copilot-specific Skills directory if `.claude/skills/` and `.agents/skills/` are picked up adequately — see OQ-1.
  - **Copilot CLI** has a separate custom-instruction mechanism; not addressed in v1.
- **AGENTS.md** is the cross-tool standard (Linux Foundation Agentic AI Foundation, Dec 2025). Supported by Codex and several other coding agents; Claude Code is the relevant holdout for this repo (uses `CLAUDE.md`).
- **GitHub CLI** supports `gh pr create`, `gh pr checks --watch`, and `gh pr merge` with `--merge`, `--delete-branch`. (Auto-merge via `--auto` is supported but is not used in v1; see `/ship` requirements.)

### Validated repo assumptions

These describe the current repo state the procedures depend on. Kept fresh by bidirectional links rather than `Last verified` dates.

- The repo has `CLAUDE.md` at root; no `AGENTS.md`, no `.claude/`, no `.agents/`, no `.github/skills/`, no `.github/prompts/` directories yet.
- Branching strategy is trunk-based: feature branches PR into `main`.
- GitHub branch protection requires PRs into `main` and the status check `Lint & Functional Tests` (managed in `scripts/update-main-branch-protection.mjs`).
- E2E and CodeQL are advisory per `docs/doc-github.md`; E2E can flake on cold start.
- `ci.yml` runs lint, typecheck, migrations, and functional tests for non-docs PRs.
- `ci-docs-skip.yml` posts the same `Lint & Functional Tests` job name for docs-only changes under `docs/**` or root `CLAUDE.md`. Both report under the same status name, so docs-only PRs go green within seconds with no special-casing.
- `e2e.yml` runs Playwright against the Vercel preview, fired by the `deployment_status` event.
- `npm test` runs lint + typecheck + local DB setup + Vitest + Playwright e2e (the slow flaky full suite). Repo `CLAUDE.md` currently says "Run `npm test` before committing" — must be reconciled with the procedure-doc guidance in Phase 1a.
- Schema is defined in `src/server/schema.ts`; Drizzle migrations live under `drizzle/`.
- Project-board automation: `PR Linked → In progress`, `PR Merged → Done` (per `docs/doc-strategy-project-management.md`). Closing keywords (`Closes #N`/`Fixes #N`/`Resolves #N`) create the GitHub-linked-PR relationship the automation depends on; plain `(#N)` references are visible context but do not create that link.
- `vercel.json` `ignoreCommand` already skips preview builds for docs-only branch diffs.

## 3. Proposed Design

### Proposed architecture

#### Files: new vs existing

The v1 work splits cleanly into new files, edits to existing files, and existing files that stay as-is. Crucial principle: **strategy docs are policy/rationale for humans; procedure docs are imperative step-by-step for agents.** Procedure docs *reference* strategy docs; they never duplicate them.

| File / folder | Status | Role |
|---|---|---|
| `docs/ai-procedures/index.md` | **NEW** | Discoverable map: canonical files, adapter locations, extension recipe, maintenance triggers, and policy/reference docs. See Appendix E for the creation and maintenance workflow. |
| `docs/ai-procedures/{commit,pr,ship}.md` | **NEW** | Imperative step-by-step for agents — single source of truth for procedure logic |
| `AGENTS.md` (root) | **NEW** | Cross-tool index, ≤30 lines — points at `docs/ai-procedures/index.md` |
| `.claude/skills/{commit,pr,ship}/SKILL.md` | **NEW** | Claude Code adapter (Skills format) |
| `.agents/skills/{commit,pr,ship}/SKILL.md` | **NEW** | Codex adapter (and likely Copilot Chat, pending OQ-1 verification) |
| `.github/copilot-instructions.md` | **NEW (Phase 3, conditional)** | Copilot index pointing at AGENTS.md — only if OQ-1 verification shows it materially improves Copilot reliability |
| `.github/skills/{commit,pr,ship}/SKILL.md` | **NEW (Phase 3, conditional)** | Copilot-specific Skills — only if OQ-1 verification shows `.claude/skills/` + `.agents/skills/` aren't picked up adequately |
| `CLAUDE.md` (root) | **EDIT** | Add pointer to `AGENTS.md` and `docs/ai-procedures/index.md`; reconcile pre-commit gate from `npm test` to lint + typecheck + functional |
| `docs/doc-strategy-committing.md` | **EDIT** | Add new "Conventions" section (currently emergent in `git log` only); expand AI-trailer subsection covering both commit and PR-body trailer; add "Related AI procedures" back-link section |
| `docs/doc-strategy-branching.md` | **EDIT (back-link only)** | Add "Related AI procedures" back-link section |
| `docs/doc-github.md` | **EDIT (back-link only)** | Add "Related AI procedures" back-link section |
| `docs/doc-strategy-project-management.md` | **EDIT (back-link only)** | Add "Related AI procedures" back-link section |
| `.github/PULL_REQUEST_TEMPLATE.md` (or equivalent) | **NEW or EDIT** | Add two checklist items: (a) smoke-test prompt when `docs/ai-procedures/**` is touched; (b) anchor/rule check when any of the four high-impact policy docs (`doc-strategy-*.md`, `doc-github.md`) is touched |
| `README.md` | **EDIT** | Add a short "Working with AI assistants" section pointing at `docs/ai-procedures/index.md` |

#### File layout

```
docs/ai-procedures/
  index.md               # discoverable map: canonical files, adapters, extension recipe
  commit.md              # canonical commit procedure
  pr.md                  # canonical PR-open + watch procedure
  ship.md                # canonical headline workflow: ensure-PR → wait → confirm → merge → tidy

AGENTS.md                # cross-tool index — short, points at docs/ai-procedures/index.md
CLAUDE.md                # already exists — adds pointer to AGENTS.md + index.md

.claude/skills/
  commit/SKILL.md        # Claude Code adapter (Skill format)
  pr/SKILL.md
  ship/SKILL.md

.agents/skills/
  commit/SKILL.md        # Codex adapter; likely also picked up by Copilot Chat
  pr/SKILL.md
  ship/SKILL.md

.github/                                       # Phase 3, conditional on OQ-1 verification
  copilot-instructions.md                      # only if needed
  skills/{commit,pr,ship}/SKILL.md             # only if .agents/skills/ isn't picked up
```

#### Why this layout

The Files table above lists every artifact and its status. The non-obvious choices in this layout are:

- **`ai-` prefix on `docs/ai-procedures/`** disambiguates from any other "procedures" the team might add later (deployment, security, onboarding) and matches the repo's existing purpose-prefixed `docs/` convention.
- **AGENTS.md and CLAUDE.md stay tiny** by pointing at `docs/ai-procedures/index.md` rather than carrying the extension recipe themselves. CLAUDE.md exists only because Claude Code does not yet read AGENTS.md natively; it collapses to a one-line pointer when Anthropic ships AGENTS.md support.
- **Skills format over slash commands for Claude.** The same folder shape works on Codex (`.agents/skills/`) and likely on Copilot Chat — one mental model across all three tools, with implicit-invocation parity as a bonus. Cost: using Claude's slightly newer/less-documented Skills feature instead of the more-mature `.claude/commands/<name>.md`.
- **`.agents/skills/` is the cross-tool location**, not Codex-specific. VS Code Agent Skills also discover this path, so it likely covers Copilot Chat without a Copilot-specific shim.
- **`.github/skills/` and `.github/copilot-instructions.md` are conditional Phase 3 deliverables** — added only if OQ-1 verification shows that `.agents/skills/` discovery in the team's Copilot environment isn't sufficient.

#### Trade-offs explicitly chosen

- **Claude Code does not yet read AGENTS.md** → maintain `CLAUDE.md` and `AGENTS.md` in parallel. Forward-compat: collapse when Anthropic ships support.
- **Skills format over slash commands for Claude** → consistency across tools beats Claude-native frontmatter affordances; we don't currently need `argument-hint`.
- **Copilot's multiple surfaces** → coding agent + Chat IDE are covered in v1 via AGENTS.md and `.agents/skills/`; Copilot CLI is an explicit non-goal.
- **One folder per skill (Skills format) vs one file per command** → marginally heavier file structure, paid for by single-mental-model maintenance.
- **Adapter-shim folders proliferate slightly** → each adapter is 3-10 lines pointing at the canonical procedure; no procedure logic in shims.

### Documentation and source-of-truth model

- **`docs/ai-procedures/<name>.md`** = single source of truth for procedure logic.
- **`docs/ai-procedures/index.md`** = discoverable map of canonical files, adapters, extension recipe, policy-doc references.
- **`doc-strategy-committing.md` Conventions section** = single source of truth for branch / commit / PR / merge format rules. Procedure docs reference, never restate.
- **Maintenance rule:** policy docs and procedure docs should stay linked but not duplicated. When a policy doc changes, update the related `docs/ai-procedures/*` file only if the change affects what an agent should do, ask, run, stop on, or report. Appendix E describes the creation and maintenance workflow.
- **`AGENTS.md`** = cross-tool index, ≤30 lines. Points at `docs/ai-procedures/index.md`.
- **`CLAUDE.md`** = Claude Code's index. Adds pointers to `AGENTS.md` and `docs/ai-procedures/index.md`. Collapses to a one-line pointer when Claude Code ships AGENTS.md support.
- **`.github/copilot-instructions.md`** = (conditional) Copilot's index, points at AGENTS.md.

#### Discoverability

For humans: a short "Working with AI assistants" section in `README.md` pointing at `docs/ai-procedures/index.md`. A `CONTRIBUTING.md` is not needed in v1.

For agents: AGENTS.md and CLAUDE.md both point at the index, which lists every procedure doc with a one-sentence "use when" pointer. Procedure doc filenames are predictable (`commit.md`, `pr.md`, `ship.md`).

#### Drift detection

The procedure docs maintain cross-reference footers to the policy docs and config they depend on; high-impact policy docs (`doc-strategy-committing.md`, `doc-strategy-branching.md`, `doc-github.md`, `doc-strategy-project-management.md`) include "Related AI procedures" back-links; the PR template flags both procedure-doc edits (with a smoke-test prompt) and high-impact policy-doc edits (with an anchor/rule check) so neither side of the dependency drifts unnoticed. A policy-doc change requires a procedure-doc update only when it changes agent behavior: what an agent should do, ask, run, stop on, or report. Heavier mechanisms (analysis scripts, scheduled monitors, CI lint of the procedure docs themselves) are deferred to v1.1+.

## 4. Procedure Behavior

### Command/procedure scope

#### Three commands

| Command | Intent | Internal behavior |
|---|---|---|
| `/commit` | Make a single, well-formed local commit | Walk gates → propose message → human review → commit; stops at local commit. |
| `/pr` | Push current branch and ensure a PR exists in the right state | State-dispatcher; opens new PR or updates existing; reports CI status; **does not enable auto-merge**. Stops after PR is open and CI is reported. |
| `/ship` | The full "I'm done" workflow | State-aware: from a clean branch, runs commit → push → PR → wait for required + advisory CI → confirm with human → merge → tidy. Performs the merge directly. |

For end-to-end developer dialogues showing what each command looks like in practice (happy path, dirty-tree handling, schema-touch, bugfix-without-regression-test, advisory-pending-on-`/ship`, refusal cases), see **Appendix D**.

#### Naming decision: `/ship`, not `/merge`, no aliases in v1

`/ship` wins over `/merge` because it captures James's stated workflow (test + commit + make PR + watch + merge + tidy), is intent-based rather than primitive-based, and composes naturally with the primitives: `/commit` → `/pr` → `/ship` walks low-to-high abstraction.

We do not ship a `/merge` alias in v1 (synonym proliferation is overhead in a small team; "merge this" is accepted as a plain-language alias, but `/merge` is not a separate v1 command).

We do not ship a `/pr --ship` flag (the state-aware `/ship` command makes the chained-flag glue redundant; revisit in v1.1+ once both procedures are stable).

We do not enable `gh pr merge --auto` from `/pr` in v1. `/pr` prepares; `/ship` finishes. No GitHub-side auto-merge in v1. Auto-merge from `/pr` may return as an opt-in flag (e.g., `/pr --auto-merge`) once both procedures have proven stable in dogfooding.

#### State dispatch — plain English

All three commands inspect repo state and pick the right next action.

For **`/commit`**: branch != main, diff non-empty, gates pass → commit. Otherwise refuse with a clear reason.

For **`/pr`**:
- HEAD is `main` → refuse.
- Working tree dirty + commits exist → ask: include uncommitted in this PR (run `/commit`), stash, or proceed with existing commits.
- Working tree dirty + no commits → narrate "no commits yet — running `/commit` first" and continue.
- Clean tree + commits exist + no open PR → run **Open procedure**.
- Clean tree + open PR exists → push new commits to existing PR (state report).
- Open PR → report CI state. Stop. (Merging is `/ship`'s job.)
- PR merged → "already merged; want me to tidy the local branch?".

For **`/ship`**: same dispatch as `/pr`, but on "PR is green" the agent confirms with the human and then merges directly (no auto-merge); after merge it tidies the local branch (`git branch -d <branch>` after confirming remote was deleted). On advisory failure or pending state, runs the **Supervised-auto handoff** with a 5-minute bounded wait + extension option.

#### `/commit` — required step-by-step

1. **Branch check.** Refuse if HEAD is `main`.
2. **Diff scan.** `git diff` and `git diff --staged`. Abort if both empty (no-op commit).
3. **Doc-sync gate.** If touched files include schema, API shapes, or behavior covered in `CLAUDE.md` / `docs/`, prompt to update those before committing.
4. **Devjournal prompt.** If the change is teammate-relevant (heuristic: non-trivial code change, new dependency, behavior change, security-relevant), draft a `docs/devjournal.md` entry and ask the human to accept/edit/skip.
5. **Pre-commit gate.** Run `npm run lint`, `npm run typecheck`, `npm run test:functional`. All must pass. Do **not** run `npm test` (full suite includes flaky e2e) by default. **Escalate to full `npm test`** when:
   - the human explicitly requests it, OR
   - the change touches auth, schema/contract, routing, security, cross-browser/UI behavior, production config, OR
   - the change is a pre-`/ship` change without meaningful human smoke testing.
6. **Coverage heuristic.** For each `src/**` file in the diff, look for matching changes under `tests/` or a sibling `*.test.*` file. Surface gaps as questions, not refusals. **Bugfix exception**: a bugfix (commit subject starts with `Fix:` or PR closes a bug-tagged issue) without a regression test is a near-blocker — require explicit human acknowledgement before continuing.
7. **Schema-touch detection.** If `src/server/schema.ts` or anything under `drizzle/` is in the diff, surface what the generated migration SQL touches and confirm the expand-contract phase per `doc-strategy-committing.md`. Refuse to bundle expand and contract phases in the same PR (existing rule: *"Each phase is its own PR and deploy. Never combine expand and contract in a single deploy."*).
8. **Issue lookup.** If the human named an issue, `gh issue view <N>` to confirm it exists and is open. If `gh` is unavailable, skip with a clear note rather than guessing.
9. **Secret scan.** Stop and ask on `.env*` files, common secret-pattern matches, or unexpectedly large files; do not commit unless the human explicitly confirms it is safe.
10. **Commit message draft.** Use the repo's recent style (`git log --oneline -20 origin/main`). Structure: subject under 70 chars, then `Why:` / `Behavior:` / `Test Plan:` body, then `Closes #N` if the commit resolves an issue, or `(#N)` for a non-resolving reference. **Test-plan provenance rule**: every line is either (a) a command the agent ran with captured output, (b) a verbatim human attestation, or (c) a single collapsed line for "ran lint + typecheck + functional locally". Never invented.
11. **Co-author trailer.** Default-include `Co-Authored-By:` with model specificity when the agent ran `/commit` AND can read its own model identity. If model identity is not visible, stop and ask the human rather than inventing one. Cache the human's answer for the session. For genuinely shared authorship (e.g., the human did most of the typing and the agent advised), attach the trailer only on explicit human confirmation.
12. **Stage explicitly.** `git add <files>` — never `git add -A` or `git add .`.
13. **Commit.** Pass message via heredoc. If a commit hook or local gate fails, fix the issue and retry safely. Do **not** use `git commit --amend` or otherwise rewrite existing commits unless the human explicitly approves.
14. **Stop.** Don't push. Output: commit SHA + suggestion to run `/pr` or `/ship` when ready.

#### `/pr` — required structure

`/pr` prepares or updates a PR and reports CI. It does **not** merge and does **not** enable auto-merge. When the working tree isn't in the happy state, the agent evaluates with a "do no harm" lens and continues the natural next step rather than forcing the human to retype.

**Working-tree gate** (runs first, regardless of which sub-procedure follows). Inspect `W = git status --porcelain` (uncommitted changes) and `C = git log origin/main..HEAD` (commits ahead of `main`). Dispatch on the four-quadrant outcome:
- **W empty, C empty** — branch is identical to `main`. Refuse; nothing to PR.
- **W non-empty, C empty** — no commits yet. Announce ("no commits on this branch — running `/commit` first, then opening the PR") and flow into it. Human still reviews the commit message before it is written.
- **W non-empty, C non-empty** — ambiguous. Stop and ask: "you have `<N>` existing commits plus uncommitted work in `<files>`. Should the new work be part of this PR (commit it first), set aside (stash it), or shipped later (proceed with just existing commits)?" Don't pick silently.
- **W empty, C non-empty** — happy path. Continue to the sub-procedure the dispatcher selected.
- **HEAD is `main`** — refuse regardless of W/C; no safe auto-fix.

**Open procedure** (state: clean tree, commits exist, no open PR).
1. Re-run the default local gate (`npm run lint`, `npm run typecheck`, `npm run test:functional`) unless it was just run successfully for the same diff.
2. **Branch-freshness check.** `git fetch origin main && git log origin/main..HEAD`. If branch is behind `main`, ask whether to rebase before pushing.
3. **Push.** `git push -u origin <branch>`.
4. **PR title + body draft.** Title under 70 chars. Body: Context / What changed / Why / Test Plan / `Closes #N` (only when the PR resolves the issue) or `(#N)` (for non-resolving references). Test-plan provenance rule applies. Co-Authored-By trailer appended to PR body when the agent opens it (same model-specificity and ambiguity rules as the commit trailer). Draft to chat for human review before posting.
5. **Open PR.** `gh pr create` with the approved body. If `gh` is unavailable, stop and report the manual alternative.
6. **Report CI state.** Run `gh pr checks <N>` (or `--watch` briefly) to observe required + advisory state. Print PR URL + check summary.
7. Stop. Stay available — the human can run `/ship` when ready.

**Update-existing-PR path** (state: clean tree, commits exist, open PR exists).
- Skip the title/body draft.
- Push the new commits to the existing branch (`git push`).
- Note in chat: "Pushed `<SHA>` to existing PR #<N>." Report current CI status.

**Docs-only awareness.** Recognize that for branches whose entire diff is docs-only, the no-op `Lint & Functional Tests` status posts in seconds via `ci-docs-skip.yml`. No special-casing needed; the agent just polls and gets green fast.

#### `/ship` — required structure

`/ship` finishes a PR. It performs the merge directly — no `gh pr merge --auto`, no GitHub-side auto-merge in v1.

1. Run the same Working-tree gate and state dispatcher as `/pr`. From clean + commits + no PR: invoke `/pr`'s **Open procedure** first, then continue here.
2. **Resolve the target PR** from the current branch, an explicit PR number, or a user-provided URL.
3. **Confirm required check is green.** `gh pr checks <N>`. If `Lint & Functional Tests` is not green, refuse and surface the failure.
4. **Inspect advisory check state** (E2E + CodeQL):
   - Both already green → proceed.
   - Either red → run **Supervised-auto handoff** (proceed / abort / troubleshoot).
   - Either pending or unavailable → wait up to **5 minutes**, polling at ~30-second intervals.
5. After the 5-minute window, if any advisory is still pending or unavailable → run **Supervised-auto handoff** with an additional **"wait another 5 minutes"** option for the case where the human can see e2e is genuinely still running and wants to extend.

   *Rationale for the 5-minute default*: empirically grounded in repo history. Of recent paired CI/E2E runs where E2E completed after CI, ~94% finished within 5 minutes of CI green. The remaining ~6% are cold-start or network-tail cases where human judgment is the right next step.
6. **Branch-freshness check.** If the PR is behind `main`, ask whether to rebase + re-push (which restarts CI) or hand off.
7. **Confirm with human before merge.** Show the PR URL and a short summary (commit count, files changed, +/- line counts) and ask: *"Ready to merge PR #<N>? [Y/n]"*. **Always confirm** — even when `/ship` opened the PR earlier in the same run. This preserves the "no replacement for human PR review" non-goal.
8. **Merge.** `gh pr merge <N> --merge --delete-branch`. Use merge commit by default; squash only on explicit human request. Never bypass branch protection, force merge, or use admin bypass.
9. **Tidy local branch.** After confirming remote branch deletion, run `git branch -d <branch>` locally. Switch back to `main` and `git pull` so the human's working state is clean for the next change.
10. **Post-merge confirmation.** Report the merge SHA and link to Vercel's deploy status.

**Supervised-auto handoff** (runs when an advisory check fails, is unavailable, or is still pending after the bounded wait). The agent does not silently merge through it and does not silently abort. It surfaces the failure with options and stays in the conversation:
1. **Proceed.** Merge despite the advisory state (human takes responsibility). Still subject to step 7's merge confirmation.
2. **Abort.** Don't merge; treat the advisory as a real signal.
3. **Troubleshoot together.** Walk the failure with the agent — read the CodeQL alert / inspect the failing E2E test / draft a fix.
4. **Wait another 5 minutes.** Available when state is pending/unavailable; extends the bounded wait window without re-invoking `/ship`.

This keeps the agent in the loop where it adds value (helping resolve), not just at the bookend.

### Guardrails and edge cases

Cross-cutting safety items. Per-command details live with each command's step list.

- **Refuse on `main`.** No commits, pushes, PR-open, or merge from `main`.
- **Working-tree gate.** Before any `/pr` or `/ship` action, inspect uncommitted changes (W) and commits ahead of `main` (C); the four-quadrant outcome dictates the next step (see `/pr`'s Working-tree gate for the dispatch table).
- **Schema change without expand-contract.** Refuse to bundle expand+contract in one PR. Procedural enforcement of an existing rule from `doc-strategy-committing.md`.
- **Secret-bearing files: stop and ask.** `.env*` files, common secret-pattern matches, or unexpectedly large files trigger a pause; do not commit unless the human explicitly confirms it is safe.
- **No `--no-verify`, no force-push, no force-merge, no admin bypass.** Period.
- **No `--amend` without explicit human approval.** Preserves audit trail on hook failures and review iterations.
- **No silent merge through advisory failures.** Advisory red, unavailable, or pending-after-bounded-wait states all hand off to the human via the Supervised-auto handoff.
- **No GitHub-side auto-merge in v1.** `/pr` reports CI state and stops; `/ship` performs the merge directly when CI is green and the human has confirmed.
- **Test-plan provenance.** Every line is grounded in commands the agent ran, verbatim human attestations, or one collapsed local-gate line — never invented.
- **Resumability.** Re-running `/pr` or `/ship` inspects state and continues from there rather than duplicating PRs or commits. Idempotent on the same input.
- **`gh` unavailability or auth gap.** If `gh` (or equivalent GitHub access) is unavailable or unauthenticated, stop with the missing capability and the manual alternative; do not pretend another tool exists, do not skip the GitHub-side step silently, do not invent statuses.
- **Human review before `/ship` merges.** `/ship` confirms with the human before invoking `gh pr merge`, even when it opened the PR in the same run.
- **Failure handoff.** Show the failing command, exit state, relevant URL, and the next safe options. Stay in the conversation.

## 5. Requirements and Delivery

### Detailed requirements

#### P0 — required for v1

Slim traceability index. Each entry references the canonical source-of-truth section above.

- **P0.1 — Canonical procedure docs.** `docs/ai-procedures/{commit,pr,ship}.md` are the only files containing procedure logic.
- **P0.2 — Procedure index file.** `docs/ai-procedures/index.md` is the discoverable map: canonical files, adapter locations, extension recipe, and a list of policy/reference docs that remain authoritative for humans.
- **P0.3 — Cross-tool index entrypoints.** `AGENTS.md` and `CLAUDE.md` exist at root; both ≤30 lines, both point at `docs/ai-procedures/index.md`.
- **P0.4 — Claude Code adapter.** `.claude/skills/{commit,pr,ship}/SKILL.md`. Each ≤10 lines (name, description, body pointing at the canonical procedure).
- **P0.5 — Codex adapter.** `.agents/skills/{commit,pr,ship}/SKILL.md`. Same shape as the Claude adapter.
- **P0.6 — GitHub Copilot integration.** Coding agent reads via `AGENTS.md`; IDE Chat picks up `.agents/skills/` (pending OQ-1 verification). If OQ-1 verifies negative, add `.github/copilot-instructions.md` and `.github/skills/{commit,pr,ship}/SKILL.md` in Phase 3.
- **P0.7 — Default pre-commit gate.** `lint + typecheck + test:functional`. See `/commit` step 5 for escalation triggers. CLAUDE.md edit reconciles current "run `npm test`" guidance.
- **P0.8 — State-aware dispatch on `/pr` and `/ship`.** Both inspect branch state and pick the right next action; idempotent on re-run. See state-dispatch tables in command descriptions.
- **P0.9 — Schema-touch detection routes to expand-contract review.** Inline in `commit.md` and `pr.md`. Refuses to bundle expand and contract phases in the same PR.
- **P0.10 — Devjournal nudge embedded in `/commit`.** Inline.
- **P0.11 — Supervised-auto handoff for advisory check states.** 5-minute bounded wait; options: proceed / abort / troubleshoot / wait another 5 minutes.
- **P0.12 — Loud failure handoff.** No `--no-verify`, no force-push, no silent skip, no silent merge through advisory failure, no admin bypass.
- **P0.13 — Compose with existing skills.** Procedure docs reference `/review` and `/security-review` as composition points; do not absorb or duplicate.
- **P0.14 — Conventions encoded in `doc-strategy-committing.md`.** New "Conventions" section captures branch / commit / PR / merge format rules; procedure docs reference rather than restate.
- **P0.15 — AI-attribution trailer in commits and PR bodies.** Model specificity required; ambiguity handling per `/commit` step 11.
- **P0.16 — Issue linkage rule.** Closing keywords (`Closes`/`Fixes`/`Resolves`) only when the PR resolves the issue; plain `(#N)` for non-resolving references.
- **P0.17 — Drift-aware documentation.** Cross-reference footers in procedure docs; a `Maintenance Triggers` section in `docs/ai-procedures/index.md`; "Related AI procedures" back-link sections in high-impact policy docs (`doc-strategy-committing.md`, `doc-strategy-branching.md`, `doc-github.md`, `doc-strategy-project-management.md`); PR-template checklist with two items: (a) when `docs/ai-procedures/**` is touched — *"smoke-tested end-to-end with at least one assistant?"*; (b) when any of the four high-impact policy docs above is touched — *"if you changed referenced anchors or added rules with procedural implications, did you check the matching procedure docs?"* Appendix E defines how the trigger list and `Depends on` footers stay aligned.
- **P0.18 — Human-review-of-diff checkpoint before `/ship` merges.** `/ship` confirms with the human ("Ready to merge PR #<N>? [Y/n]") before invoking `gh pr merge`, even when `/ship` opened the PR in the same run.

#### Out of scope for v1 (deferred to v1.1+ or later)

> **Tracking convention**: items marked **`[tracked: #TBD]`** should have a GitHub issue filed when v1 lands; replace `TBD` with the issue number once the issue exists. Use `grep TBD` to find every placeholder across this spec at once.

- `procedures/devjournal.md` and `procedures/migrate.md` as separate files (inlined in commit.md for v1).
- Procedure-doc CI lint that asserts every procedure doc has the required sections and that referenced strategy-doc anchors still exist. **[tracked: #TBD]**
- Per-procedure observability (Axiom hooks).
- Per-tool shims for Cursor / Aider / other assistants beyond the named three. **[tracked: #TBD]**
- Aider-specific design (Aider's auto-commit defeats the gate model; not worth fighting in v1). Subsumed under the Cursor/Aider tracking ticket above.
- `/pr --ship` chained flag and/or `/pr --auto-merge` opt-in. Revisit in v1.1+ once `/pr` and `/ship` have stabilized in dogfooding. **[tracked: #TBD]**
- Coverage delta tooling (Vitest coverage provider + baseline-storage CI step). **[tracked: #TBD]**
- Docs-only-skip awareness in `/pr` (unnecessary — `ci-docs-skip.yml` already reports the same status name within seconds).
- **Reproducible-analysis script (`scripts/analyze-ci-e2e-timing.mjs`) + monthly drift-monitor workflow.** The 5-minute wait number is empirically derived from recent CI/E2E history (see `/ship` rationale). Revisit if dogfooding shows `/ship` hanging on advisories more often than expected. **[tracked: #TBD]**
- **Inverse pointers in volatile config files.** JSON doesn't support comments and the maintenance value is marginal at the team's current size; covered well enough by the bidirectional back-links and PR-template checklist.

> **Permanent non-goal** (not deferred): generated CI step that runs an AI agent on a draft PR (`claude -p`, `codex exec`, etc.). Per the non-goals list above.

### Phased rollout

This rollout sequences risk down before scope. Phase 0 cheaply validates the adapter architecture, Phase 1a establishes the canonical procedure docs as the cross-tool source of truth, Phases 1b–3 layer per-tool adapters (Claude first, Codex second, Copilot last and conditional on OQ-1), and Phase 4 defers the long-tail to tracked tickets.

**Phase 0 — Pre-implementation spike (recommended, optional).**

A throwaway smoke test that de-risks the architecture before Phase 1 commits to it. Cost: ~15-30 minutes, ~30 lines across 4 files, easily reverted. Validates whether Claude Code, Codex CLI, and Copilot Chat each discover and invoke a sample skill at the proposed paths — and specifically whether Copilot Chat picks up `.agents/skills/` without a Copilot-specific shim (which would pre-resolve OQ-1 and collapse Phase 3 to a verification-only PR). Full file content and run procedure in **Appendix B**.

**Phase 1a — Canonical docs and instruction indexes (one PR).**
- `docs/ai-procedures/index.md` + `commit.md` + `pr.md` + `ship.md` with cross-reference footers.
- `docs/ai-procedures/walkthroughs.md` (relocated from this spec's Appendix D for ongoing maintenance; the appendix becomes a stub pointer once the file lands). **[tracked: #TBD]**
- `AGENTS.md` (root, ≤30 lines).
- `CLAUDE.md` updates: pointer to `AGENTS.md` and `docs/ai-procedures/index.md`, fix the "run `npm test` before committing" line.
- `doc-strategy-committing.md`, `doc-strategy-branching.md`, `doc-github.md`, `doc-strategy-project-management.md` — each gets a "Related AI procedures" back-link section.
- `doc-strategy-committing.md` also gets the new Conventions section and the expanded AI-trailer subsection covering both commit and PR-body trailers.
- PR-template checklist items: smoke-test prompt when `docs/ai-procedures/**` is touched; anchor/rule check when any of the four high-impact policy docs is touched.
- `README.md` "Working with AI assistants" mention.

Acceptance: peer-reviewed and merged. Reviewable as docs only — no behavior change for any assistant.

**Phase 1b — Claude adapter (separate PR).**
- `.claude/skills/{commit,pr,ship}/SKILL.md`.

Acceptance: dogfood for one week — every commit from at least one Claude Code user goes through `/commit` or `/ship`. Verify a Phase 1b PR carries the AI trailer in both the commit and the PR body.

**Phase 2 — Codex adapter (separate PR).**
- `.agents/skills/{commit,pr,ship}/SKILL.md`.
- AGENTS.md updates if any Codex-specific affordances surface during implementation.

Acceptance: a Codex CLI user dogfoods one PR end-to-end via implicit-invoke skills.

**Phase 3 — Copilot adapter verification (conditional).**
- Verify in the team's actual VS Code / Copilot Chat environment whether `.agents/skills/` is discovered adequately.
- If yes: no additional files; document the verification outcome in the index.
- If no: add `.github/copilot-instructions.md` and `.github/skills/{commit,pr,ship}/SKILL.md`.

Acceptance: a Copilot Chat IDE user dogfoods one PR end-to-end. The Copilot coding agent inherits the procedure via AGENTS.md (validated by triggering one issue-to-PR run).

**Phase 4 (deferred / opportunistic).** Each item below cross-references the same `[tracked: #TBD]` placeholder used in *Out of scope for v1* — file one GitHub issue per item, replace TBD with the issue number in both places.

- First-class `/journal`, `/migrate` shims. **[tracked: #TBD]**
- `/pr --auto-merge` opt-in flag (or `/pr --ship` chained sequence). **[tracked: #TBD]**
- Reproducible-analysis script + monthly drift-monitor workflow for the `/ship` wait window. **[tracked: #TBD]**
- Procedure-doc CI lint (full version). **[tracked: #TBD]**
- Cursor / Aider shims. **[tracked: #TBD]**
- Coverage delta tooling. **[tracked: #TBD]**

#### Why this phasing

- Phase 1a is the load-bearing one — it establishes the source-of-truth model independently of any assistant. Reviewable as docs only.
- Phase 1b is small (3 files) and dogfoodable independently.
- Phases 2-3 are non-breaking additions: no procedure rewrites, only new shim folders.
- Phase 3 may collapse to a one-line "verified" PR if `.agents/skills/` is sufficient.
- The CLAUDE.md `npm test` reconciliation is bundled with Phase 1a to keep the human and AI guidance consistent from day one.

### Acceptance criteria

For v1 to be considered shipped:

1. A user in a fresh clone produces **equivalent procedure behavior** (not necessarily identical UX) to a manually-executed checkin per `doc-strategy-committing.md`, regardless of which assistant they use:
   - **Claude Code:** `/commit`, `/pr`, `/ship` via `.claude/skills/`.
   - **Codex CLI:** "commit this" / "open a PR for this" / "ship this" (implicit) or `$commit` / `$pr` / `$ship` (explicit) via `.agents/skills/`.
   - **Copilot Chat IDE:** `/commit`, `/pr`, `/ship` via `.agents/skills/` (if OQ-1 verifies positive) or Phase-3 `.github/skills/`.
   - **Copilot coding agent:** procedure-conformant output via `AGENTS.md` (no slash UX).
2. A docs-only PR opened via `/pr` completes within seconds of CI's no-op job posting status (verifies the existing workflow handles it without special-casing).
3. CLAUDE.md, AGENTS.md, `docs/ai-procedures/index.md`, and `doc-strategy-committing.md` are internally consistent (no contradictory pre-commit gate guidance, no contradictory commit-message rules).
4. The procedure docs reference rather than restate `doc-strategy-committing.md`'s Conventions section, each procedure doc has a `Depends on` footer for its policy/config-file dependencies, and `docs/ai-procedures/index.md` includes a `Maintenance Triggers` section that reflects those dependencies.
5. The high-impact policy docs (`doc-strategy-committing.md`, `doc-strategy-branching.md`, `doc-github.md`, `doc-strategy-project-management.md`) each carry a "Related AI procedures" back-link section.
6. A change to a procedure doc is a normal PR (no special workflow needed); the PR-template smoke-test checklist item fires when `docs/ai-procedures/**` is touched.
7. The repo dogfoods cleanly for one week per phase (1b, 2, 3) with no convention-drift PR comments.
8. AI-opened PRs carry the `Co-Authored-By:` trailer in both the commit and the PR body.
9. `/ship` confirms with the human ("Ready to merge PR #<N>? [Y/n]") before merging, even when it opened the PR in the same run.
10. Commit text, PR text, AI attribution, advisory check failures, and ambiguous working-tree states all require explicit human review before the agent proceeds.

## 6. Open Questions

| ID | Question | Blocking | Why | Mitigation / options | Recommendation |
|---|---|---|---|---|---|
| **OQ-1** | What's the right Copilot adapter surface in the team's actual environment? Does `.agents/skills/` get picked up adequately by Copilot Chat in our IDE configuration, or do we need `.github/skills/` and/or `.github/copilot-instructions.md`? | **Blocks Phase 3 implementation.** Not blocking for spec / Phase 1a-1b / Phase 2. **Phase 0 spike may pre-resolve.** | VS Code/Copilot Agent Skills documents discovery from `.github/skills/`, `.claude/skills/`, and `.agents/skills/`. Real-world coverage may vary by Copilot product surface and version. | Run the Phase 0 spike (recommended): if Copilot Chat picks up `.agents/skills/hello/SKILL.md`, Phase 3 collapses to a verification-only PR. Otherwise verify in the team's actual VS Code/Copilot environment after Phases 1+2 land and add Copilot-specific files if needed. | Run Phase 0 spike before Phase 1a commits; otherwise resolve during Phase 3 verification. |
| **OQ-2** | Local-gate policy alignment between `docs/doc-strategy-committing.md` and the v1 AI procedure. | Blocking for Phase 1a implementation; not blocking for the spec. | Current `doc-strategy-committing.md` says "run `npm test`" (full suite). The v1 AI procedure runs lint + typecheck + functional by default and escalates per the `/commit` step 5 trigger list. | Update `doc-strategy-committing.md` to match the v1 AI policy in Phase 1a. The human-vs-agent guidance must agree. | Adopt the v1 AI gate; resolve the doc-policy mismatch in Phase 1a. |
| **OQ-3** | Exact `Co-Authored-By:` form per provider. | Blocks final commit/PR-body trailer text per provider; partially deferrable by phase. | `doc-strategy-committing.md` references AI co-author trailers; existing repo history has Claude-specific examples. GitHub documents the generic format as `Co-authored-by: name <email>`. Codex source defines the default identity as `Codex <noreply@openai.com>` but the repo can require model-specificity when visible. Copilot's underlying model varies (GPT-4o, Claude, Gemini) per user setting. | (a) Lift documented forms verbatim where possible. (b) Claude: `Co-Authored-By: Claude <model/version> <noreply@anthropic.com>`. (c) Codex: `Co-Authored-By: Codex <model/version> <noreply@openai.com>` when model is visible; verified-fallback `Codex <noreply@openai.com>` requires explicit human confirmation. (d) Copilot: verify during Phase 3 against the team's Copilot config. (e) Detection: default-include when agent ran `/commit` AND model identity is readable; ask once per session, cache. If model identity isn't visible, stop and ask rather than inventing. For ambiguous shared authorship, attach trailer only on explicit human confirm. | Resolve Claude form during Phase 1b; Codex form during Phase 2; Copilot form during Phase 3. |
| **OQ-4** | When (and how) do we migrate `CLAUDE.md` → `AGENTS.md` once Claude Code ships AGENTS.md support? | Non-blocking. Future planning. | Currently Claude Code only reads CLAUDE.md; once it reads AGENTS.md, dual-maintenance is wasted effort. | (a) Watch [anthropics/claude-code#6235](https://github.com/anthropics/claude-code/issues/6235); when shipped, collapse CLAUDE.md to a one-line pointer at AGENTS.md; (b) Move CLAUDE.md content into AGENTS.md and `@import` from CLAUDE.md if Claude Code adds an import mechanism. | Defer. The tracking link in AGENTS.md or CLAUDE.md is the watcher. |
| **OQ-5** | Should `/pr --ship` (chained sequence) or `/pr --auto-merge` (opt-in flag) enter v1.1+? | Non-blocking; deferred. | Chaining or auto-merge increases convenience but combines the riskiest operations. The team can learn from separate `/pr` and `/ship` use first. | (a) Defer. Add later as a thin sequence only after both procedures are stable. (b) Require a clean state and passing required checks before any chained ship behavior. | Defer to v1.1+. |
| **OQ-6** | Should `CODEOWNERS` require a second-pair-of-eyes review on `docs/ai-procedures/**`? | Non-blocking. Process choice. | Small team; CODEOWNERS may add friction without payoff. | (a) Add CODEOWNERS for `docs/ai-procedures/**`; (b) Trust normal PR review. | Defer. Small team; trust normal PR review + the PR-template smoke-test checklist. Revisit if a regression bites. |

## Appendices

### Appendix A: Changelog

- **v1** — initial unified spec from the two planning drafts.
- **v2** — incorporated approved design revisions, Codex Skills alignment, Phase 0 spike, and early `/ship` wait/drift ideas.
- **v3** — simplified scope after peer review; clarified `/ship`, CI, attribution, and docs-drift policies; split rollout phases; moved supporting material into appendices.
- **v4 (this document)** — structure-only reorganization for readability: numbered body sections, unified appendices, appendix renumbering, updated cross-references, and a short rollout summary. No substantive design changes.

### Appendix B: Phase 0 spike — file content and run procedure

A throwaway smoke test that de-risks the architecture before Phase 1a commits to it. Cost: ~15-30 minutes, ~30 lines across 4 files. Easily reverted.

What it tests (three yes/no questions):

1. Does Claude Code discover and invoke `.claude/skills/<name>/SKILL.md`?
2. Does Codex CLI discover and invoke `.agents/skills/<name>/SKILL.md` both implicitly (natural-language match) and explicitly (`$<name>`)?
3. Does VS Code/Copilot Chat pick up `.agents/skills/` *without* a Copilot-specific shim? (A "yes" pre-resolves OQ-1 and collapses Phase 3 to a verification-only PR.)

Spike files (all marked throwaway via the `_spike-` filename prefix or `hello` skill name; deleted before Phase 1 lands):

```
docs/ai-procedures/_spike-hello.md       # canonical procedure (~10 lines)
.claude/skills/hello/SKILL.md            # Claude adapter (~5 lines)
.agents/skills/hello/SKILL.md            # Codex + Copilot adapter (~5 lines)
```

Spike procedure content (`docs/ai-procedures/_spike-hello.md`):

```markdown
# Spike: hello procedure

Smoke test for the portable AI procedure framework. Throwaway; delete before Phase 1.

When invoked:
1. Print "✓ Skill discovered" and which adapter file invoked you.
2. Print "✓ Procedure doc loaded from docs/ai-procedures/_spike-hello.md."
3. Print the current branch (`git rev-parse --abbrev-ref HEAD`).
4. Stop.
```

Adapter content (each `SKILL.md`):

```markdown
---
name: hello
description: Smoke test for the portable procedure framework. Verifies skill discovery and the procedure-doc indirection pattern.
---

Read `docs/ai-procedures/_spike-hello.md` and follow its instructions.
```

How to run: open the repo in each tool in turn; invoke `/hello` (Claude Code), say "run the hello smoke test" (Codex implicit) or `$hello` (Codex explicit), and `/hello` (Copilot Chat). Each should walk through the three prints. Note any tool that fails to discover the skill or fails the indirection.

Acceptance: at minimum, Claude Code passes (validates the indirection pattern + Skills format). Codex and Copilot pass results feed OQ-1 and Phase 2/3 sequencing. A failure on any tool changes the architecture meaningfully before Phase 1; that's exactly what the spike is for.

Cleanup: the spike files are not part of v1 deliverables. Delete the three files (or merge + revert the spike branch) before Phase 1a lands. Capture the verification outcome in `docs/ai-procedures/index.md` or a brief devjournal entry.

### Appendix C: Worked example — PR #90

To validate the spec against real iteration, walk [PR #90](https://github.com/Intentional-Society/is-app/pull/90) (which added `--fix` to `check-env.mjs`, closing [#73](https://github.com/Intentional-Society/is-app/issues/73), with three commits: feature, CodeQL fix, wording polish):

- **Commit 1 (feature).** Human runs `/commit for #73`. Agent walks the gates (no schema touch → no escalation; bugfix-or-feature classification not bugfix → no regression-test acknowledgement needed), drafts the Why/Test Plan body, includes the Co-Authored-By trailer with model specificity, commits. Human runs `/pr`; the agent pushes, opens the PR with `Closes #73`, the same trailer in the PR body, and reports CI state. Project board flips #73 to *In progress* via existing automation. The agent does **not** enable auto-merge.
- **Commit 2 (CodeQL fix).** Human fixes the TOCTOU pattern; runs `/commit`. Agent re-verifies CI checks. `/pr` dispatches to the **Update-existing-PR path** and pushes — the PR's CI re-runs.
- **CodeQL re-run flips the advisory check.** Human runs `/ship`. Required check is green. CodeQL alert has cleared on the new commit; E2E is still pending. Agent waits up to 5 minutes. E2E completes successfully within the window. Agent shows the PR URL and a short summary (3 commits, 4 files, +52/-8 lines) and asks *"Ready to merge PR #90? [Y/n]"*; human acknowledges. Agent merges via `gh pr merge --merge --delete-branch`, tidies the local branch, reports the merge SHA + Vercel deploy URL.
- **Commit 3 (self-review polish).** Same iteration shape. Human runs `/review` first (existing skill) to surface wording issues; the procedure composes cleanly. Final push, then `/ship` again — agent reconfirms before merging.
- **If either advisory had been red, unavailable, or still pending past the 5-minute wait** (CodeQL not clearing, E2E flaking on cold start, etc.), `/ship` would have run the **Supervised-auto handoff** with proceed / abort / troubleshoot / wait-another-5 options instead of merging through. Even on "proceed," the human-review-of-diff checkpoint at step 7 still fires before merge.

### Appendix D: Developer walkthroughs

These are illustrative dialogues — what using `/commit`, `/pr`, and `/ship` looks like from a developer's chair. They are not normative; the canonical behavior lives in the procedure step-lists above. Use these for team review of the developer experience.

When Phase 1a lands, this content moves to `docs/ai-procedures/walkthroughs.md` alongside the procedure docs themselves; this appendix becomes a stub pointer. **[tracked: #TBD]** (same placeholder as Phase 1a's `walkthroughs.md` deliverable).

#### D-1: Happy path — `/commit` then `/ship` end-to-end

Branch `add-keyword-filter-to-members-list`, four files modified including a new test file. Working tree dirty; no commits yet.

```
Dev: /commit for #142

Agent: Diff: 4 files, +87/-12 lines (members page, filter component, API,
  new test). No schema touch. Pre-commit gate (lint + typecheck +
  test:functional): ✓. Issue #142 confirmed open.

  Drafting commit message:

    Add keyword filter to members list

    Why: ... (Members list grew past where eyeballing works.)
    Behavior: ... (Filter input above the table, debounced 200ms.)
    Test Plan: Added tests/members-filter.test.ts; ran lint + typecheck +
    functional locally.
    Closes #142

    Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

  Review or edit?

Dev: lgtm

Agent: Staged 4 files explicitly. Committed 7e3a1b2. Run /pr or /ship.

Dev: /ship

Agent: Branch clean, 1 commit ahead of main. Pushed.

  No PR exists; drafting one with the same trailer in the body and Closes #142.
  Title: "Add keyword filter to members list". Review?

Dev: ship it

Agent: Opened PR #145. Watching CI:
  ✓ Lint & Functional Tests (required)
  ⏳ E2E (advisory, Vercel preview building)
  ⏳ CodeQL (advisory)

  [3 min later] All advisories ✓. PR #145: 1 commit, 4 files, +87/-12.
  Ready to merge PR #145? [Y/n]

Dev: Y

Agent: Merged 9c4f8d1 → main. Tidied local branch (deleted, switched to main,
  pulled). Vercel deploy: <url>.
```

#### D-2: Dirty tree on `/pr` — W × C ambiguity

Branch already has 2 commits; dev has uncommitted edits to an unrelated logging tweak.

```
Dev: /pr

Agent: Working-tree gate: 2 commits ahead of main, plus uncommitted changes
  in src/lib/log.ts and src/app/page.tsx. Ambiguous — these don't look related
  to the existing commits.

  Should the new work be:
    [a] Part of this PR — I'll run /commit first.
    [b] Set aside — I'll stash it.
    [c] Shipped later — I'll proceed with just the 2 existing commits.

  Which?

Dev: c — different change, will PR it separately

Agent: Proceeding with the 2 existing commits. Pushed. Opened PR #146; required
  check pending. Run /ship when CI is green.

  Note: your stashed-or-uncommitted log changes are still in the working tree.
```

#### D-3: Schema touch on `/commit`

Dev modified `src/server/schema.ts` to add a `last_active_at` column on `profiles`.

```
Dev: /commit

Agent: Diff includes src/server/schema.ts. Generating migration preview...

    ALTER TABLE profiles ADD COLUMN last_active_at TIMESTAMP WITH TIME ZONE;

  Per doc-strategy-committing.md, schema changes follow expand-contract.
  Which phase is this PR?

    [expand]   Add the column; no client code reads it yet. (This change
               looks like expand: schema-only, no app reads.)
    [migrate]  Client code starts reading the column. Separate PR.
    [contract] Removing a column. Separate PR.

  Refusing to bundle expand+contract in one PR.

Dev: expand

Agent: Confirmed expand. Pre-commit gate: ✓. Drafting message; do you want
  to link an issue (e.g., `Closes #N` if this resolves one), or use a plain
  reference, or neither?

Dev: no issue, just commit

Agent: Committed 4b2e9a1.
```

#### D-4: Bugfix without regression test

Dev wrote a one-line fix to `src/lib/api.ts` to handle a null case.

```
Dev: /commit  (subject: "Fix: handle null profile in getProfileForSelf")

Agent: Diff: 1 file, +3/-1. Bugfix (subject starts with "Fix:"). Coverage
  heuristic: no matching test changes detected. Bugfixes without a regression
  test are a near-blocker — they tend to recur silently.

  Options:
    [a] Add a regression test now. I can scaffold one based on the fix shape.
    [b] Acknowledge the gap and proceed. You take responsibility for not
        regressing this. I'll note it in the test plan as an explicit gap.
    [c] Cancel.

Dev: a, scaffold it

Agent: The fix handles `getProfileForSelf` returning undefined when the user
  has no profile row. Drafting tests/api-getProfileForSelf.test.ts:

    [test code expects undefined-not-thrown for missing profile]

  Run it locally? Should fail before your fix and pass after.
```

#### D-5: Advisory pending past 5 min on `/ship`

Dev pushed a commit to an open PR; required check is green but the Vercel preview is cold-starting.

```
Dev: /ship

Agent: PR #147 found. Required check ✓ (Lint & Functional Tests).
  Advisory: E2E pending (Vercel preview building); CodeQL ✓.

  Waiting up to 5 minutes...

  [5 min] E2E still pending. Reached the wait limit.

  Options:
    [proceed]      Merge despite E2E unknown. You take responsibility.
    [abort]        Don't merge; treat the unknown as a real signal.
    [troubleshoot] Inspect the Vercel build / preview deploy with me.
    [wait+5]       Wait another 5 minutes. Vercel cold-starts can take a while.

  Which?

Dev: wait+5

Agent: Watching... [3 min later] E2E ✓.

  PR #147: 2 commits, 1 file, +14/-3 lines. Ready to merge PR #147? [Y/n]

Dev: Y

Agent: Merged 5d8c2f4 → main. Tidied local branch.
```

#### D-6: Refusal cases

Two compact examples of the agent refusing safely.

```
[Refused — committing on main]

Dev: /commit

Agent: Refusing: HEAD is `main`. Switch to a feature branch first
  (`git switch -c <name>`).

[Refused — empty diff]

Dev: /commit

Agent: Refusing: nothing to commit. Working tree and staged area are both
  clean. Did you mean to add files first?

[Refused — gh unavailable]

Dev: /pr

Agent: Stopping: gh is not authenticated (`gh auth status` reports no token).
  I can't open the PR for you. Manual alternative:
    1. git push -u origin <branch>
    2. open https://github.com/Intentional-Society/is-app/compare/<branch>
    3. paste this draft body: <draft>
  Re-run /pr after `gh auth login` if you want me to take it from here.
```

### Appendix E: Creating and Maintaining AI Procedure Docs

The AI procedure docs are agent-facing runbooks. They translate existing repo policy into step-by-step behavior for `/commit`, `/pr`, and `/ship`.

They do not replace the policy docs, and they should not duplicate long policy explanations.

#### E-1: Initial creation

Create each procedure doc by reading the relevant repo policy docs and converting only the agent-actionable parts into steps.

Use these sources:

| Procedure doc | Primary sources |
|---|---|
| `docs/ai-procedures/commit.md` | `docs/doc-strategy-committing.md`, `docs/doc-github.md`, `package.json` |
| `docs/ai-procedures/pr.md` | `docs/doc-strategy-committing.md`, `docs/doc-strategy-branching.md`, `docs/doc-github.md`, `docs/doc-strategy-project-management.md` |
| `docs/ai-procedures/ship.md` | `docs/doc-strategy-committing.md`, `docs/doc-github.md`, `docs/doc-strategy-branching.md` |
| `docs/ai-procedures/index.md` | the procedure docs, adapter locations, maintenance triggers, and extension guidance |

When creating a procedure doc, include:

- When to use it.
- Preconditions.
- Steps the agent should perform.
- Human confirmation points.
- Failure handoff behavior.
- A `Depends on` footer listing policy/config files it relies on.

Do not include:

- Long rationale copied from policy docs.
- Assistant-specific trigger details.
- Speculative future-agent behavior.
- Unrelated governance rules.

#### E-2: Ongoing maintenance

Policy docs remain the source of truth for rationale and repo conventions. Procedure docs are updated only when a change affects agent behavior.

The key question is:

> Did this change alter what the AI procedure should do, ask, run, stop on, or report?

If yes, update or verify the related procedure doc.

If no, leave the procedure doc alone.

Examples:

| Change | Procedure update? | Reason |
|---|---:|---|
| Typo or background clarification | No | No agent behavior changed. |
| Clarify why merge commits are preferred | Usually no | Rationale changed, not procedure. |
| Change default local gate | Yes | `/commit` and `/pr` must run different commands. |
| Change commit-message format | Yes | `/commit` drafts commit text. |
| Change PR body format | Yes | `/pr` drafts PR text. |
| Change issue-linkage rule | Yes | `/commit` and `/pr` need different linkage behavior. |
| Change branch protection required check name | Yes | `/pr` and `/ship` must watch the right check. |
| Change E2E from advisory to required | Yes | `/ship` merge readiness changes. |
| Change expand-contract safety rule | Yes | `/commit` and `/pr` schema guardrails change. |
| Rename a policy heading linked from a procedure footer | Yes | Cross-reference links need repair. |

#### E-3: Maintenance triggers

`docs/ai-procedures/index.md` should include a `Maintenance Triggers` section.

That section is the compact list of files that should make a human or agent ask:

> Did this change affect `/commit`, `/pr`, or `/ship` behavior?

Example:

```markdown
## Maintenance Triggers

If these files change, check whether `/commit`, `/pr`, or `/ship` behavior changed:

- `docs/doc-strategy-committing.md`
- `docs/doc-strategy-branching.md`
- `docs/doc-github.md`
- `docs/doc-strategy-project-management.md`
- `package.json`
- `.github/workflows/ci.yml`
- `.github/workflows/ci-docs-skip.yml`
- `.github/workflows/e2e.yml`
- `vercel.json`
```

This is a reminder list, not a hard enforcement system.

#### E-4: Keeping the trigger list current

Each procedure doc should end with a short `Depends on` footer.

Example:

```markdown
## Depends on

- `docs/doc-strategy-committing.md` — commit format, test-plan rules, issue linkage, AI attribution, schema-change policy.
- `docs/doc-github.md` — required check name, advisory checks, docs-only CI behavior.
- `package.json` — local test scripts.
- `.github/workflows/ci.yml` — required CI behavior.
```

The `Maintenance Triggers` list in `docs/ai-procedures/index.md` should be the practical union of these dependencies.

When editing any `docs/ai-procedures/*.md` file:

- If a new dependency appears in a `Depends on` footer, add it to `Maintenance Triggers` or explain why it does not need to trigger review.
- If a dependency is removed from all procedure footers, consider removing it from `Maintenance Triggers`.
- Prefer specific files over broad globs.
- Do not add noisy triggers that rarely affect agent behavior.

#### E-5: How agents should help

Agents should provide lightweight nudges during normal work.

When editing or committing a file listed in `Maintenance Triggers`, the agent should say:

```text
This touches a maintenance trigger for the AI procedures. Should I check whether `/commit`, `/pr`, or `/ship` needs an update?
```

When editing `docs/ai-procedures/*.md`, the agent should compare the edited procedure's `Depends on` footer with `docs/ai-procedures/index.md#maintenance-triggers`.

If something is missing, the agent should ask:

```text
This procedure now depends on `<file>`, but that file is not listed in Maintenance Triggers. Should I add it?
```

If a dependency was removed, the agent should ask:

```text
This procedure no longer depends on `<file>`. Should I check whether it can be removed from Maintenance Triggers?
```

These are prompts, not automatic edits. The human decides.

#### E-6: Human review reminders

The PR template should include one lightweight reminder:

```markdown
- [ ] If this PR changes commit, PR, CI, schema, issue-linkage, attribution, or merge policy, I checked whether `docs/ai-procedures/*` needs an update.
```

No CI enforcement is required in v1.

#### E-7: Anti-patterns

Avoid these maintenance patterns:

- Copying long policy sections into procedure docs.
- Updating procedure docs for every wording-only policy edit.
- Letting adapter files contain procedure logic.
- Adding CI enforcement before lightweight review reminders prove insufficient.
- Treating `Last verified` dates as freshness theater for internal repo docs.
- Adding broad maintenance triggers that create constant false alarms.

The desired maintenance burden is one extra review question:

> Did this change alter what the AI procedure should do?

### Appendix F: Sources / verification

Used during spec authoring:

- Anthropic — [Claude Code slash commands](https://code.claude.com/docs/en/slash-commands), [Claude Code overview](https://code.claude.com/docs/en/overview), [Claude Code memory docs](https://code.claude.com/docs/en/memory), [issue #6235 (AGENTS.md support)](https://github.com/anthropics/claude-code/issues/6235).
- OpenAI — [Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md), [Codex Skills](https://developers.openai.com/codex/skills), [Codex CLI slash commands](https://developers.openai.com/codex/cli/slash-commands), [Codex CLI reference](https://developers.openai.com/codex/cli/reference), [openai/codex docs/skills.md](https://github.com/openai/codex/blob/main/docs/skills.md).
- GitHub — [Copilot coding agent supports AGENTS.md (Aug 2025)](https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/), [Copilot prompt files](https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files), [Copilot custom instructions](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot), [Copilot custom-instructions support matrix](https://docs.github.com/en/copilot/reference/custom-instructions-support).
- Microsoft — [VS Code custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions), [VS Code Agent Skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills).
- GitHub CLI — [`gh pr create`](https://cli.github.com/manual/gh_pr_create), [`gh pr checks`](https://cli.github.com/manual/gh_pr_checks), [`gh pr merge`](https://cli.github.com/manual/gh_pr_merge).
- [agents.md cross-tool standard](https://agents.md/).
- Repo — `CLAUDE.md`, `docs/doc-strategy-committing.md`, `docs/doc-strategy-branching.md`, `docs/doc-github.md`, `docs/doc-strategy-project-management.md`, `.github/workflows/ci.yml`, `.github/workflows/ci-docs-skip.yml`, `.github/workflows/e2e.yml`, `vercel.json`, `package.json`, `scripts/update-main-branch-protection.mjs`.
- Issue thread — [#62](https://github.com/Intentional-Society/is-app/issues/62) and comments [4320013457](https://github.com/Intentional-Society/is-app/issues/62#issuecomment-4320013457), [4374728362](https://github.com/Intentional-Society/is-app/issues/62#issuecomment-4374728362).
- Empirical analysis — recent 100 `ci.yml` and 100 `e2e.yml` runs from `Intentional-Society/is-app`, paired by SHA on 2026-05-06; underpins the 5-minute `/ship` wait-window default.
