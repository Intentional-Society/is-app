# Conversion manifest — evals/evals.json → per-skill runnable files

**Authored:** 2026-07-19 12:40 -07:00 (Fable, from a full read of `evals/evals.json`).
**Status:** APPROVED by Blake 2026-07-19 — the ground truth for Phase 1 (spec II.2a).
**Purpose:** the exact, id-by-id ground truth for Phase 1. Every original eval maps to
resulting ID(s) + `kind` + disposition; Phase 1 acceptance = every row traceably
delivered. This file is committed to the repo alongside the spec (pre-Phase-0 step) so
the Phase-1 packet's link resolves for any fresh agent.

**Totals (Phase-1 conversion):** 23 originals → **26 resulting entries** = **17 execution + 9 routing**.
No original is dropped or semantically rewritten (I.4 full-fidelity Must); splits only.

> **Phase-7 right-sizing amendment (2026-07-20):** `ship-2c` (immediate-abort) was removed
> as a strict subset of `ship-2a` → **25 entries = 16 execution + 9 routing**. Every critical
> behavior stays covered; see the Phase-7 amendment section at the end of this file for the
> rationale and the coverage proof. The contract test's pinned execution-ID set and this
> file are updated together.

## commit (8 originals → 9 entries: 4 execution, 5 routing)

| Original | Kind | Resulting | Fixture (proposed) | Notes |
|---|---|---|---|---|
| commit-1-happy-path | execution | commit-1 (1:1) | `feature-dirty-clean-payload` | Approval-Y `human_script` |
| commit-2-refusal-suspicious-file | execution | commit-2 (1:1) | `feature-dirty-with-env-local` | Script: human directs "remove from payload" |
| commit-3-edge-schema… (a/b bundle) | execution | **commit-3a**, **commit-3b** (split) | `feature-schema-expand-only`; `feature-schema-expand-plus-contract` | gh fixture includes open issue 142; 3b asserts hard refusal, no commit |
| commit-4-nl-intent-gate | routing | commit-4 (1:1) | — | Manual runbook; Phase-8 automation |
| commit-5-nl-step-0-skip-conditions | routing | commit-5 (1:1, **no split**) | — | **Resolves the flagged contradiction:** the splitting rule applies to execution evals only; commit-5's three sub-scenarios (slash / delegation / opt-out) stay one routing eval whose manual runbook — and later the Phase-8 runner — enumerates them as three queries |
| commit-6-nl-affirmation-after-offer | routing | commit-6 (1:1) | — | Two-turn; Phase-8 multi-turn driver case |
| commit-7-nl-affirmation-to-explain | routing | commit-7 (1:1) | — | Negative control |
| commit-8-commit-keyword-as-topic | routing | commit-8 (1:1) | — | Over-trigger control |

## pr (9 originals → 9 entries: 7 execution, 2 routing)

| Original | Kind | Resulting | Fixture (proposed) | Notes |
|---|---|---|---|---|
| pr-1-happy-path-existing-pr | execution | pr-1 | `feature-open-pr-two-new-commits` | |
| pr-2-refusal-branch-mismatch | execution | pr-2 | `feature-x-with-pr-on-feature-y` | |
| pr-3-edge-dirty-tree-delegation | execution | pr-3 | `feature-dirty-no-pr` | Exercises /pr→/commit delegation incl. marker + handoff line (transcript-observable) |
| pr-4-new-pr-cc-title-breaking-change | execution | pr-4 | `feature-breaking-change-no-pr` | |
| pr-5-reviewer-cold-cache-numeric-pick | execution | pr-5 | `feature-no-pr-cold-reviewer-cache` | Script: "1 3"; gh fixture: 5 collaborators post-bot-filter |
| pr-6-reviewer-warm-cache-natural-language | execution | pr-6 | `feature-no-pr-warm-reviewer-cache` | Script: "james and benji"; asserts zero `gh api` calls (call-log negative + liveness) |
| pr-7-reviewer-rejection-refresh-and-reask | execution | pr-7 | `feature-no-pr-stale-reviewer-cache` | **Stub requirement: per-call sequenced responses** (reviewer-invalid error → refreshed list) — named Phase-2 input |
| pr-8-nl-intent-gate | routing | pr-8 | — | Manual runbook |
| pr-9-nl-affirmation-after-offer | routing | pr-9 | — | Two-turn; Phase-8 driver case |

## ship (6 originals → 8 entries: 6 execution, 2 routing; **Phase-7: `ship-2c` removed → 5 execution, 2 routing**)

| Original | Kind | Resulting | Fixture (proposed) | Notes |
|---|---|---|---|---|
| ship-1-happy-path-preexisting-pr | execution | ship-1 | `feature-open-pr-all-green` | Stub: checks all-green, merge, post-merge run list |
| ship-2-refusal-pending-advisory (3 option branches) | execution | **ship-2a** (wait+5, then abort), **ship-2b** (troubleshoot); ~~ship-2c (abort)~~ **removed in Phase 7** | `feature-open-pr-advisory-pending` (shared) | **Resolves the branch-keyed-script finding:** one entry per scripted branch, each a single-prose `human_script`; retained arms assert the exact three-option menu, no `proceed`. First-wave (2a ≈ 10 min wall clock — the batch's long pole). **Phase-7 right-sizing: `ship-2c` (immediate abort) removed — every one of its assertions is a strict subset of `ship-2a`, which reaches the identical abort behavior via a superset path (wait+5 → abort); `ship-2b` retains the distinct troubleshoot arm. Abort-abandons-merge safety stays covered by `ship-2a`.** |
| ship-3-edge-docs-only-pr | execution | ship-3 | `docs-only-open-pr` | Asserts NO 5-min advisory wait on the docs-only path |
| ship-4-nl-ship-intent-redirects | routing | ship-4 | — | Session-level (`disable-model-invocation` + harness ask-rule); Phase-8 known limit R8: assert observable (no `pr merge` in call log) |
| ship-5-explain-ship-question | routing | ship-5 | — | Over-trigger control |
| ship-6-delegation-cascade | **execution** | ship-6 | `feature-dirty-no-pr` (reused) | **Resolves the flagged classification:** the cascade *mechanics* (markers written/cleared, handoff lines in transcript, Step-0 suppression, commit→PR→merge through stubs) are sandbox-executable by an executor following the three SKILL.md files; the live Skill-tool announcement nuance stays additionally covered by the routing runbook next to ship-4/5 (cross-noted there). Accepted-compromise per R7: scripted "typed /ship" premise tests step-following, not live UX |

## Cross-cutting requirements this manifest creates

1. **Phase 2 fixture set** = the 14 distinct proposed fixture names above (routing evals
   need none at baseline). Phase-2 acceptance already requires a profile per referenced
   name.
2. **Stub sequencing:** pr-7 requires per-call response sequencing — explicitly in
   Phase 2's stub scope.
3. **Wall clock:** ship-2a is the batch's long pole (~10 min) — first-wave scheduling
   confirmed necessary, not just nice.
4. **Routing runbook enumeration:** commit-5's three sub-scenarios and ship-6's
   live-announcement nuance are named entries in the strategy doc's manual runbook
   section; Phase 8 later automates them as distinct queries.
5. **Trailer nit for Phase 1:** commit-1's expected_output hardcodes
   `Claude Opus 4.7` in the co-author trailer — the converted expectation should assert
   the trailer *pattern* (any current Claude model identity), not a pinned version.

## Phase-7 right-sizing amendment (2026-07-20)

**Status:** Phase-7 right-sizing removal, prepared for the **Phase-7 human checkpoint**
(spec III.2 row 7 — "Agent + human review"); the maintainer reviews and signs off on this
removal before the phase PR merges. Phase 7 is the prioritization pass against the I.4
right-sized-coverage Should ("every skill's critical behaviors have evals and the suite
stays lean").

**Removal — one eval, `ship-2c` (`refusal-pending-advisory-immediate-abort`):**

`ship-2c` shares `ship-2a`'s fixture (`feature-open-pr-advisory-pending`) and setup. Its
human script is a single `abort` at the first three-option prompt. Its assertions are:
(1) enters the step-8 wait, waits 5 min; (2) presents exactly three options, no `proceed`;
(3) on `abort`, abandons the merge; (4) no `gh pr merge` in the transcript/log/stub.

**Every one of those four assertions is a strict subset of `ship-2a`.** `ship-2a`'s script
is `wait+5` then `abort`: it exercises the step-8 wait, the exact three-option menu (on
*both* prompts), the `wait+5` re-loop, **and** `abort → no merge` — the identical
abort-abandons-merge safety assertion `ship-2c` makes, reached via a superset path.
`abort` is the same handler regardless of which wait-loop iteration invokes it, so no
realistic bug is caught by `ship-2c` but not `ship-2a`. `ship-2b` independently retains
the distinct `troubleshoot` arm.

**Coverage retained (nothing lost):**
- Three-option menu, no `proceed` offered under pending advisories → `ship-2a` + `ship-2b`.
- `wait+5` re-loop → `ship-2a`.
- `troubleshoot` exit (surfaces check name + URL) → `ship-2b`.
- `abort` abandons the merge with no `gh pr merge` → `ship-2a`.
- Phase 6 (#514) already ran a **ship-2c-shaped abort scenario with a real executor**,
  archived the raw triad, and graded it **PASS** under the merge-discrimination rule — so
  the abort path is live-validated, and `ship-2a` carries the identical assertion.

**Why remove rather than keep:** `ship-2c` adds a full sandboxed LLM run (~5 min) and zero
unique coverage — it is exactly the "redundant" eval Phase 7 exists to trim. Keeping it is
redundancy-as-insurance, which right-sizing removes.

**Leanness scope note:** trimming only bites on **execution** evals (each = one sandboxed
LLM run). Routing evals are documented manual runbooks (≈zero batch cost) and each guards a
distinct confusion mode; the Layer-C `trigger-evals.json` sets are sized to the spec's ~20
target for triggering-rate signal. Both were reviewed and left intact. The reviewer-picker
trio (`pr-5`/`pr-6`/`pr-7`) covers three mutually-exclusive cache/error paths (cold /
warm / stale-entry-rejection) and was retained.

**Files updated in lockstep:** `.claude/skills/ship/evals/evals.json` (removed),
`tests/functional/skills/skill-contract.test.ts` (`EXPECTED_EXECUTION_IDS.ship`),
this manifest, and a cosmetic comment in `scripts/skill-evals/lib/fixtures.mjs`.
No skill content (`SKILL.md`) changed.
