# Plan: Portable AI Procedure Framework — Implementation Dev Plan

> Implementation plan for the Skills and policy edits specified in `docs/spec-portable-ai-procedures.md` (the merged v5 spec from PR #133). The spec is the behavioral source of truth; this plan covers how to build, validate, and ship.

**Last updated:** 2026-05-25

---

## 1. Goals & non-goals

**Goals:**
- Produce three working Claude Code Skills (`/commit`, `/pr`, `/ship`) under `.claude/skills/` that satisfy spec §4.
- Apply the seven spec-§3-listed policy-doc edits and one PR-template item.
- Verify each Skill passes its eval set and a live end-to-end smoke-test.
- Self-host: the implementation PR ships via the newly-built `/ship` Skill.

**Non-goals:**
- Scope creep beyond spec §3 File layout.
- Pre-writing SKILL.md body prose in this plan (Phase 7a produces the bodies via `skill-creator`).
- Sprint-by-sprint scheduling or calendar commitments.
- Any item from spec §1 Non-goals (AGENTS.md, multi-vendor support, helper commands, hooks, daemons, `.claude/commands/*`).

---

## 2. Scope in / scope out

**In scope:**

| Artifact | Description |
|---|---|
| `.claude/skills/commit/SKILL.md` | New — `/commit` Skill body per spec §4.1 |
| `.claude/skills/pr/SKILL.md` | New — `/pr` Skill body per spec §4.2 |
| `.claude/skills/ship/SKILL.md` | New — `/ship` Skill body per spec §4.3 |
| `evals/evals.json` | New — 2–3 eval prompts per Skill (committed artifact: these are Skill acceptance definitions, not generated run outputs) |
| `CLAUDE.md` | Add "AI Skills" section |
| `docs/strategy-committing.md` | Add AI co-author trailer subsection |
| `docs/strategy-branching.md` | Add one-line "Related Skills" back-link |
| `docs/doc-github.md` | Add one-line "Related Skills" back-link |
| `docs/strategy-project-management.md` | Add one-line "Related Skills" back-link |
| `README.md` | Add "Working with AI assistants" section |
| `.github/PULL_REQUEST_TEMPLATE.md` | Add smoke-test checklist item |
| `scripts/update-main-branch-protection.mjs` | Verify only — no churn expected |
| `.gitignore` | Add generated-output paths only if they exist and are not committed (do not ignore `evals/evals.json`) |

**Out of scope:**
- Any file not listed in spec §3 File layout.
- Final SKILL.md body prose (produced during Phase 7a, not prescribed here).
- Verbatim wording for policy-doc sections (drafted in Phase 7b based on the actual Skill bodies).

---

## 3. Phase ordering & rationale

| Phase | What | Why this order |
|---|---|---|
| **7a** | Build Skills via `skill-creator` | Policy docs reference Skill names and paths; Skills must exist before policy docs can point to them accurately |
| **7b** | Update policy docs | Wording can reference what's actually in the Skill bodies; keeps prose synchronized |
| **7c** | Update config | Branch-protection verify and gitignore check are quick and don't block 7a/7b; doing last avoids speculative gitignore entries |
| **8** | Validation (eval set + smoke-test) | All artifacts must be present and correct before shipping |
| **9** | Ship via self-hosted `/ship` | Integration test that closes the loop; `/ship` earns its reputation by shipping itself |
| **10** | Wrap-up | Devjournal, tracker finalization, issue closure |

---

## 4. Phase 7a — Build the Skills

### 7a.0 — Tooling preflight

| Field | Detail |
|---|---|
| **Files touched** | None (read-only checks) |
| **What to verify** | (1) `skill-creator` SKILL.md accessible — check `.claude/skills/skill-creator/SKILL.md` (project-level) then `~/.claude/skills/skill-creator/SKILL.md` (user-level); (2) `evals/evals.json` path exists or can be created; (3) `eval-viewer/generate_review.py` exists; (4) `scripts/run_loop.py` exists |
| **Acceptance** | All four located and accessible; if any is missing, surface to Blake before drafting Skills |
| **Effort** | < 1h |
| **Dependencies** | None |
| **Risks** | `skill-creator` may be at user level only and not visible in the project tree; eval/review scripts may not exist in this repo — surfacing early prevents mid-build surprises |
| **Durable output / resume checkpoint** | Tracker Resume notes updated with four-item checklist: each ✓ or "missing — blocked" |

### 7a.1 — Build `/commit`

| Field | Detail |
|---|---|
| **Files touched** | `.claude/skills/commit/SKILL.md`; `evals/evals.json` |
| **Eval prompts (3)** | (1) Happy path: `/commit "fix profile redirect"` from a dirty feature branch — expect correct staging, `npm test`, bundled approval block with a **CC-format subject** (e.g., `fix: fix profile redirect`), commit, push. (2) Refusal: `/commit "add user endpoint"` with `.env.local` in the diff — expect suspicious-file blocker to fire and refuse. (3) Edge case: `/commit #142` with a schema touch in the payload — expect expand-vs-contract phase surface and `prod:db:expand` note; also test combined expand+contract refusal separately. |
| **Build steps** | Draft body per spec §4.1 (including §4.1 Step 12 Conventional Commit style rule added 2026-05-27) → write 3 eval prompts in `evals/evals.json` → run with-skill vs baseline subagents → review via `eval-viewer/generate_review.py` → iterate body → run `scripts/run_loop.py` description-optimization |
| **Acceptance** | Passes all 3 evals; body ≤500 lines; `## Depends on` footer matches spec §3 Anti-drift example; self-host check passes (the Skill can be used to commit changes to its own SKILL.md); **commit message in approval block uses CC format** (`<type>[(scope)]: <imperative summary>` ≤70 chars; breaking changes get `!` + `BREAKING CHANGE:` footer per spec §4.1 Step 12) |
| **Effort** | 1–4h |
| **Dependencies** | 7a.0 (tooling confirmed) |
| **Risks** | Payload-protection refusal logic has many branches (6+ blocker categories) — evals may require multiple iterations; combined expand+contract refusal needs an explicit eval prompt; stash-safety needs explicit coverage: `/commit` and downstream `/ship` behavior must never use `git stash && <command>; git stash pop` or otherwise mutate the stash stack during verification — use `git status --short` / `git status --porcelain` and explicit diffs instead, and refuse with a manual commit-or-stash suggestion when branch switching would cross a dirty tree |
| **Durable output / resume checkpoint** | `.claude/skills/commit/SKILL.md` exists with content; 3 eval prompts in `evals/evals.json`; tracker note: "7a.1 /commit ✓ [date]" |

### 7a.2 — Build `/pr`

| Field | Detail |
|---|---|
| **Files touched** | `.claude/skills/pr/SKILL.md`; `evals/evals.json` |
| **Eval prompts (3+1)** | (1) Happy path: `/pr` on current branch with new commits, existing open PR — expect push, PR-comment summary, URL printed, stop. (2) Refusal: `/pr 145` resolves to a PR on a different branch — expect refusal naming both branches with suggestion to use `/ship 145`. (3) Edge case: `/pr "wire up dashboard"` with dirty working tree — expect delegation to `/commit`, then PR creation on return. **(4) New PR path (CC title): `/pr` on a branch with no open PR — expect rebase-or-no-op check, push, and `gh pr create` with CC-format title in the approval draft (e.g., `feat: wire up dashboard`); verify type selection and `!`-flag path for breaking changes per spec §4.2 Step 9 (added 2026-05-27).** |
| **Build steps** | Draft body per spec §4.2 (including §4.2 Step 9 CC title rule added 2026-05-27) → write 3+1 eval prompts → same skill-creator build loop as 7a.1 |
| **Acceptance** | Passes all 4 evals; body ≤500 lines; `## Depends on` footer accurate; delegation to `/commit` correctly narrated without over-specifying `/commit`'s internals; **PR title in approval draft uses CC format** (`<type>[(scope)]: <imperative summary>` ≤70 chars) per spec §4.2 Step 9 |
| **Effort** | 1–4h |
| **Dependencies** | 7a.1 (delegation behavior is already understood from `/commit`'s body; eval prompts for delegation edge case benefit from `/commit` being settled) |
| **Risks** | Delegation flow (`/pr` → `/commit`) is hard to eval without a real working tree; eval prompts may need scenario-based narration rather than strict input/output matching |
| **Durable output / resume checkpoint** | `.claude/skills/pr/SKILL.md` exists; 3 eval prompts added to `evals/evals.json`; tracker note: "7a.2 /pr ✓ [date]" |

### 7a.3 — Build `/ship`

| Field | Detail |
|---|---|
| **Files touched** | `.claude/skills/ship/SKILL.md`; `evals/evals.json` |
| **Eval prompts (3)** | (1) Happy path: `/ship` on a pre-existing PR with all required + advisory checks green — expect no extra confirmation (PR pre-existed), merge, tidy, post-merge watch. (2) Refusal: `/ship` with a pending advisory check past the 5-minute wait window — expect three-option prompt (`wait+5`, `troubleshoot`, `abort`) with no "proceed" option. (3) Edge case: `/ship` on a docs-only PR — expect absent advisory checks treated as expected per docs-only rule; proceed on required-green only. |
| **V.5 note** | In Step 7 (schema-expand wait), add concrete "while-you-wait" narration: "The `forward-migrate-prod-schema-expansion` workflow pauses on a manual approval gate in the `prod-db` GitHub Actions environment. This gate can take minutes to hours depending on team availability. Surface the workflow run URL, migration SQL preview, and PR link so the human can open the approval from GitHub. You will remain in a wait loop here — this is expected." |
| **Build steps** | Draft body per spec §4.3 (including V.5 narration) → write 3 eval prompts → same skill-creator build loop |
| **Acceptance** | Passes all 3 evals; body ≤500 lines; `## Depends on` footer accurate; docs-only path correctly handles absent advisories; V.5 narration present in Step 7; self-host check: the Skill can ship the implementation PR itself (verified in Phase 9) |
| **Effort** | 1–4h |
| **Dependencies** | 7a.1 + 7a.2 (ship orchestrates both; delegation chain must be settled before ship's body can reference it) |
| **Risks** | `/ship` has the most conditional branches (schema-expand, docs-only, branch-switch, wait window, confirmation policy) — highest iteration risk of the three; self-host check is load-bearing for Phase 9 |
| **Durable output / resume checkpoint** | `.claude/skills/ship/SKILL.md` exists; 3 eval prompts added; V.5 narration present; tracker note: "7a.3 /ship ✓ [date]" |

---

## 5. Phase 7b — Update policy docs

All 7b edits share the same per-substep fields:
- **Effort:** < 1h per file
- **Dependencies:** Phase 7a complete (wording can reference Skill names and paths as they actually exist)
- **Risks:** Target sections may have evolved since the spec was written — re-read each file before editing to find the right insertion point
- **Resume checkpoint:** `git diff --stat` shows which files have been touched; the table below serves as a per-file checklist; mark each ✓ in tracker Resume notes as completed

| File | Target section | Kind of edit | Acceptance criterion | Durable output |
|---|---|---|---|---|
| `CLAUDE.md` | New "AI Skills" section (after any existing skills/tools section, or near end) | Add short section listing all three Skills by name, invocation form (`/commit`, `/pr`, `/ship`), and path (`.claude/skills/`) | Section exists; names all three Skills with invocation forms | File diff shows only the new section; no collateral edits |
| `docs/strategy-committing.md` | New AI Skills subsection(s) (within or immediately after the commit-format section) | Add two subsections: **(a) Conventional Commit style** — capture the `<type>[(scope)]: <imperative summary>` format, preferred type list, and breaking-change `!` / `BREAKING CHANGE:` footer rule from spec §4.1 Step 12 (added 2026-05-27); **(b) AI co-author trailer** — capture the detect-or-ask-with-body-caveat protocol from spec §4.1 Trailer protocol. Both keep the strategy doc in sync with the Skills. | Both subsections exist; CC format and preferred types documented; detect-or-ask trailer logic present | File diff shows only the two new subsections; no collateral edits |
| `docs/strategy-branching.md` | Relevant existing section (branching conventions or workflow section) | Add one-line "Related Skills" back-link: e.g., "Related Skills: `/commit` auto-branches on `main`; `/ship` handles the merge step." | Back-link present; no collateral edits | One-line diff |
| `docs/doc-github.md` | Relevant existing section (CI or merge policy section) | Add one-line "Related Skills" back-link: e.g., "Related Skills: `/ship` reads CI results and merges via `gh pr merge`." | Back-link present | One-line diff |
| `docs/strategy-project-management.md` | Relevant existing section (PR workflow or project-board section) | Add one-line "Related Skills" back-link: e.g., "Related Skills: `/pr` opens PRs; `/ship` merges them and triggers board automation." | Back-link present | One-line diff |
| `README.md` | New "Working with AI assistants" section (near the end, or after any existing onboarding section) | Add short section pointing at `.claude/skills/`; name the three Skills and their invocations | Section exists; path reference to `.claude/skills/` present; all three Skills named | File diff shows only the new section |
| `.github/PULL_REQUEST_TEMPLATE.md` | Existing checklist (add one item) | Add: `- [ ] If this PR changes \`.claude/skills/**/SKILL.md\`, smoke-test the affected Skill on a realistic prompt.` | Item present verbatim in the checklist | One-line diff |

---

## 6. Phase 7c — Update config

### 7c.1 — Branch-protection script verify

| Field | Detail |
|---|---|
| **Files touched** | `scripts/update-main-branch-protection.mjs` (verify only; patch only if a gap is found) |
| **What to verify** | Required check name matches spec §2 (`Lint & Functional Tests`); `strict_required_status_checks_policy: true` present; no settings that contradict spec §2 Repo assumptions (merge-commit-only, `delete_branch_on_merge`, etc.) |
| **Acceptance** | Script confirmed accurate with no changes needed; or a minimal targeted fix is applied with a clear comment |
| **Effort** | < 1h |
| **Dependencies** | None |
| **Risks** | A renamed required check would block the implementation PR's merge — surface any mismatch to Blake before Phase 8 |
| **Durable output / resume checkpoint** | Tracker note: "7c.1 branch-protection script verified ✓ [date]" or diff committed |

### 7c.2 — Eval artifact gitignore

| Field | Detail |
|---|---|
| **Files touched** | `.gitignore` (targeted additions only, if needed) |
| **Decision** | `evals/evals.json` contains eval prompt *definitions* — this is a committed artifact (it defines what correct Skill behavior looks like and is part of the per-Skill acceptance criteria). Do NOT add it to `.gitignore`. Generated outputs from `eval-viewer/generate_review.py` and `scripts/run_loop.py` (e.g., HTML review files, run caches) are local-only — add their specific paths to `.gitignore` only if they exist after a trial run and are not already committed. |
| **Acceptance** | `evals/evals.json` is not in `.gitignore`; any generated-output paths that accumulate locally and are not committed are gitignored; `git status` is clean after a full eval run |
| **Effort** | < 1h |
| **Dependencies** | 7a.0 (tooling preflight surfaces what artifacts the eval/review scripts produce locally) |
| **Risks** | Over-ignoring accidentally hides committed definitions; under-ignoring causes accidental commit of large HTML reports — check `git status` after a trial eval run before adding any ignore entries |
| **Durable output / resume checkpoint** | `.gitignore` diff (if any) shows only targeted additions; note in tracker: "7c.2 gitignore ✓ [date]" |

---

## 7. Phase 8 — Validation

### 8.1 — Eval set execution (per Skill)

| Field | Detail |
|---|---|
| **Files touched** | `evals/evals.json` (read); SKILL.md files (iterate if evals fail); generated review artifacts (local only) |
| **What to do** | For each Skill in order (`/commit`, `/pr`, `/ship`): run with-skill vs baseline subagents against all 3 eval prompts; review outputs via `eval-viewer/generate_review.py`; confirm the Skill wins or ties on all prompts; iterate body if not; re-run until passing |
| **Acceptance** | Each of the three Skills passes its full 3-prompt eval set with no remaining failures |
| **Effort** | 1–4h total (most of this is iteration time if a Skill needs body rework) |
| **Dependencies** | Phase 7a complete (all three SKILL.md bodies drafted) |
| **Risks** | A Skill may not pass evals after initial drafting — budget iteration rounds; `/ship`'s conditional branches make it hardest to get right on the first attempt |
| **Durable output / resume checkpoint** | All three SKILL.md files at their final passing versions; tracker note: "8.1 /commit ✓, /pr ✓, /ship ✓ [date]"; validation report section started |

### 8.2 — End-to-end smoke-test

| Field | Detail |
|---|---|
| **Files touched** | Whichever files change in the smoke-test PR (a small real change — e.g., a docs-only edit or minor config fix) |
| **What to do** | Pick one small real change; invoke `/ship` end-to-end from dirty working tree through post-merge watch; capture result (pass/fail, any surprises, any steps that required human intervention not expected by the spec) |
| **Acceptance** | `/ship` runs the full chain — `/commit` → `/pr` → merge → post-merge watch — without requiring workarounds outside the spec's defined failure modes |
| **Effort** | < 1h |
| **Dependencies** | 8.1 (all three eval sets pass) |
| **Risks** | Smoke-test may surface integration bugs not caught by per-Skill evals (e.g., delegation chain timing, state passing between Skills, unexpected CI timing); any bug found here requires iteration back to Phase 7a/8.1 |
| **Durable output / resume checkpoint** | Smoke-test PR merged to `main`; one-paragraph result note appended to the Phase 8 Validation Report below |

**Validation report location:** Append to this document as a "## Phase 8 Validation Report" section after execution. The report must exist in committed form before Phase 9 begins.

---

## 8. Phase 9 — Ship implementation PR via self-hosted `/ship`

| Field | Detail |
|---|---|
| **Files touched** | All Phase 7 artifacts (committed in the implementation PR): 3 SKILL.md files, `evals/evals.json`, 7 policy-doc edits, PR template item, `.gitignore` additions if any, branch-protection fix if any |
| **What to do** | Open the implementation PR with all Phase 7 changes on a fresh branch; verify all pre-merge checks are green; invoke `/ship <PR#>` using the newly-built Skill itself |
| **Acceptance** | Implementation PR merges to `main` via `/ship` with no manual workarounds; `main` is green post-merge; all three Skills are live on `main` |
| **Effort** | < 1h (assuming Skills pass validation and smoke-test) |
| **Dependencies** | Phase 8.1 + 8.2 complete; all Phase 7 changes staged on a branch with an open PR |
| **Risks** | If `/ship` has a subtle bug not caught by evals or smoke-test, it may fail to ship its own implementation PR — fall back to manual `gh pr merge --merge --delete-branch` and open a follow-up issue to fix the Skill |
| **Durable output / resume checkpoint** | Merged PR URL on `main`; all three `.claude/skills/*/SKILL.md` files visible in the merged `main` tree; tracker Step 9 ✅ Done |

---

## 9. Phase 10 — Wrap-up

| Field | Detail |
|---|---|
| **Files touched** | `docs/devjournal.md` |
| **What to do** | (1) Add devjournal entry (hard trigger: "New `.claude/skills/<name>/` Skill added" × 3; 1–2 sentences by default). (2) Mark tracker Steps 7–10 ✅ Done; clear Resume notes. (3) Confirm issue #62 is closed on GitHub (spec PR #133 carries the closing keyword; verify closure). (4) Confirm audit-trail artifacts remain in place as local-only working files. |
| **Acceptance** | Devjournal entry committed to `main`; tracker complete with all steps ✅ Done; issue #62 closed |
| **Effort** | < 1h |
| **Dependencies** | Phase 9 merged |
| **Risks** | Issue #62 may need a manual close if the closing keyword didn't auto-fire — check the issue page directly |
| **Durable output / resume checkpoint** | Devjournal entry in `docs/devjournal.md` committed; tracker Step 10 ✅ Done with Resume notes cleared |

---

## 10. V.5 implementation note — schema-expand wait narration

**When:** Phase 7a.3, when writing `/ship` body Step 7.

**What the spec says (correct but terse):** "Wait for the maintainer approval in the `prod-db` environment (the workflow pauses on a review gate before prod credentials are injected). Once the workflow completes successfully, wait for the next `e2e.yml` run..."

**What to add during Phase 7a.3:** A concrete "while-you-wait" narration in Step 7 so the human is not surprised by the gate's latency. Suggested framing:

> "The `forward-migrate-prod-schema-expansion` workflow pauses on a manual approval gate in the `prod-db` GitHub Actions environment before injecting production credentials. This gate can take minutes to hours depending on team availability. While waiting: surface the workflow run URL, the migration SQL preview, and the PR link so the human can find the approval button on GitHub. You will remain in a wait loop here — this is expected and normal."

**Acceptance:** Step 7 in the `/ship` body includes language that (a) names the `prod-db` approval gate explicitly, (b) gives a realistic latency expectation (minutes to hours), and (c) tells the human where to look while waiting. The spec text in §4.3 Step 7 is not modified — the SKILL.md body is the place for this implementation detail.

---

*Phase 8 Validation Report will be appended here after execution.*
