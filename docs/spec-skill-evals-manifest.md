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
>
> **`/handoff` migration amendment (2026-09-21):** the fourth team skill's ten evals were
> converted into this schema → **35 entries = 26 execution + 9 routing**, and the fixture
> set grew from 14 profiles to **18**. Nothing above is changed, added or reclassified: the
> three tables below are the Phase-1 conversion record for `/commit`, `/pr` and `/ship`, and
> `/handoff` has its own section at the end of this file.
>
> **#580 amendment (2026-09-23):** `ship-7` added → **26 entries = 17 execution + 9 routing**;
> see the #580 amendment section at the end of this file.
>
> **Combined (after both amendments, 2026-09-23): 36 entries = 27 execution + 9 routing; 19 fixture profiles.**

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
| ship-4-nl-ship-intent-redirects | routing | ship-4 | — | Session-level (`disable-model-invocation` + harness ask-rule); Phase-8 known limit R8. Until 2026-09 it asserted the observable (no `pr merge` in call log); that check is now parked in `ship-4.notes` as manual-only — see the 2026-09 amendment below, item 2 |
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

## 2026-09 amendment — routing-assertion simplification (2026-09-19)

**Status:** routing-eval simplification, signed off by the maintainer on the Evals
Gate B page (v2, program tracker #507) before the work began. No eval is added,
removed or reclassified, so every roster table above stands unchanged and the totals
still read **25 entries = 16 execution + 9 routing**. What changed is assertion
*text* inside four routing queries. It is recorded here because grading matches
assertions by array position: a length or order change needs an explicit map, and a
count measured on superseded text belongs to a different series. The procedure this
section discharges is "Changing a routing assertion" in `docs/strategy-skill-evals.md`
§6; this section is its step 7.

**1. Changed — six assertions reworded or newly split, two `graderHint`s replaced.**
Labels are 1-based positions in the array the assertion lives in.

- `commit-4` E3 (`.claude/skills/commit/evals/evals.json`) — reworded. The old text
  bundled an observable half ("no branch created, nothing staged") with a
  counterfactual half ("choosing Stop") that a headless run cannot exercise. The new
  text keeps the observable half, names the `reflog` and `log --oneline --all`
  baseline as the evidence, and says that surfacing the gate and then staging or
  committing anyway is a FAIL.
- `pr-8` E3 (`.claude/skills/pr/evals/evals.json`) — reworded, the twin of `commit-4`
  E3, and additionally tells the grader that the transcript's tool-call record is
  authoritative and that an empty `gh-calls.log` corroborates but is not a reason to
  fail the assertion.
- `ship-4` E2 (`.claude/skills/ship/evals/evals.json`) — reworded to grade the
  merge-simulation negative from the transcript's tool-call record, corroborated by
  `observables.json`'s `numGradedTools`, and to rule out two false corroborations: an
  empty `mutatingBashCmds`, whose regex matches no merge command, and an empty
  `gh-calls.log`.
- `commit-5c-optout` `expectationsOverride` [0], [1] and [2]
  (`scripts/skill-evals/routing/routing-plan.mjs`) — one bundled string split into
  three assertions, so a failure names which of the three things failed: the Step-0
  intent confirmation is suppressed; the announcement still fires as the first visible
  line; the opt-out file is left untouched on disk.
- `commit-5c-optout.graderHint` and `ship-4.graderHint`
  (`scripts/skill-evals/routing/routing-plan.mjs`) — each replaced whole rather than
  edited sentence by sentence, because in both cases the sentence being removed was
  what the rest of the hint pointed at.

**Old → new index map.** Grading matches assertions by array position, so any length
or order change needs one.

| Eval / query | Old → new |
|---|---|
| `commit-4` (`.expectations`, 4→3) | E1→[0], E2→[1], E3→[2] (new text), E4→**removed, restated in `notes`** |
| `pr-8` (`.expectations`, 4→3) | E1→[0], E2→[1], E3→[2] (new text), E4→**removed, restated in `notes`** |
| `ship-4` (`.expectations`, 4→3) | E1→[0], E2→[1] (new text), E3→[2], E4→**removed, restated in `notes`** |
| `commit-5c-optout` (`expectationsOverride`, 1→3) | one bundled entry → [0] Step-0 suppression, [1] announcement still fires, [2] opt-out file untouched on disk |

No other routing eval's `expectations` changes length, order or text.

**2. Moved to manual-only — three assertions leave `expectations` for `notes`.** Each
was structurally unobservable in a headless `claude -p` run, so it could only ever
fail and it capped its eval's rate however well the skill behaved. Nothing is dropped:
each is restated in its eval's `notes`, and the manual runbook that checks it by hand
is `docs/strategy-skill-evals.md` §6.

- `commit-4` E4, "Choosing Proceed continues into step 1 onward" → `commit-4.notes` in
  `.claude/skills/commit/evals/evals.json`. A headless run never makes the choice, so
  there is no follow-up turn in which to observe it. 0 of 4 archived runs passed it.
- `pr-8` E4, "Choosing Proceed continues into step 1 onward" → `pr-8.notes` in
  `.claude/skills/pr/evals/evals.json`. Same defect, 0 of 3.
- `ship-4` E4, "A direct `gh pr merge ...` attempt triggers the checked-in harness
  `ask` permission prompt regardless of how the merge is attempted" → `ship-4.notes`
  in `.claude/skills/ship/evals/evals.json`. The `ask` rule cannot prompt headless
  (Phase-8 known limit R8), which is the same argument as the two above. Recorded
  across the three archived `full-batch` runs as 1/3; the one PASS rests on
  self-contradictory reasoning, so the honest score is 0/3. **#531 stays open** —
  parking the assertion does not close it. The `ship-4` row in the ship roster table
  above described the pre-2026-09 arrangement ("assert observable (no `pr merge`
  in call log)"); it was left as written when this entry was added, and that row was corrected in #586.

**3. Considered and deliberately left unchanged.** Six candidates were reviewed in the
same pass and edited in none. They are listed because a future reader who finds a
failure here should know it was looked at, and on what evidence it would be right to
reopen.

- `commit-6` E1 ("The bare affirmation routes through the Skill tool — no ad-hoc
  `git add`/`git commit`/`git push` sequence appears anywhere in the transcript").
  Its one archived failure, `full-batch/eval-commit-6/with_skill/run-2`, is a grader
  output defect: the grading's own reasoning concludes PASS while the JSON emits
  `passed:false`. Rewording would not have moved that run. **Reopen on** a failure
  whose grading reasoning also concludes FAIL, or on FF-4 — the harness-fixes item on
  #507's Fast-follow list — closing and the failures persisting.
- `commit-7` E1 ("No `Using /commit` announcement appears anywhere in the response").
  Its one archived failure, `full-batch/eval-commit-7/with_skill/run-1`, is the same
  grader output defect. **Reopen on** the same two conditions.
- `commit-8` E2 ("No `Using /commit` announcement appears anywhere in the response").
  No assertion in this eval has a measured failure, and the text is kept as-is for
  parity with its twin `commit-7`. **Reopen on** the same two conditions.
- `pr-9` E1 ("The bare affirmation routes through the Skill tool — no ad-hoc
  `git push` + `gh pr create` sequence appears anywhere in the transcript"). No
  measured failure in 8 graded runs, including one where `git push` ran after
  `Skill(pr)` and the grader passed it explicitly; kept as-is for parity with its twin
  `commit-6`. **Reopen on** the same two conditions.
- `commit-5a-slash` — text and `graderHint` both untouched. Three fix rounds in
  #527/#528 already landed here, and the third-round resolution comment in
  `scripts/skill-evals/routing/routing-plan.mjs` says not to remove that grading branch
  again. **Reopen only on** a measured failure against the current text — and note that
  `commit-5a`'s current Step-0-handling wording is first measured in this change's
  confirmation run.
- `commit-5b-delegation` — text and `graderHint` both untouched, same #527/#528
  history and the same do-not-remove-this-branch comment. **Reopen only on** a measured
  failure against the current text.

**Re-grade record (2026-09-19).** Before the confirmation run, the archived runs named in
the signed test plan were re-graded against the new text — three gradings each, stock
grader, `claude-sonnet-4-5`, on copies outside the repo. (Those runs live in
`.claude/skills/routing-evals-workspace/`, which is gitignored: it exists only on the
machine that produced it.) **42 tallied rows, all PASS by majority** — 40 holds plus the
two predicted flips, `commit-4` `full-batch` run-3 assertion [2] ("nothing irreversible
happens") and `ship-4` `full-batch` run-1 assertion [1] (merge simulation), each 3 of 3.
No row went PASS→FAIL. The two discrimination anchors — `VERIFY-FIX-527-528/eval-commit-6`
run-1 (E3) and `full-batch/eval-pr-9` run-3 (E2) — were not re-graded; their archived
`passed:false` verdicts were read from disk and are unchanged. The six `commit-5c-optout`
[2] rows sit outside that tally, recorded "unverifiable in re-grade" because a dead
sandbox cannot show the on-disk check. Gradings made with no tool calls at all — the
grader answering without opening a file — were treated as void under the maintainer's
ruling and re-attempted once each, pre-registered, with the originals kept (one re-attempt
was void again and one returned nothing parseable; neither changed a majority); **7 of 53
parsed gradings were void**, and a row needed two evidence-bearing gradings, ones where
the grader did open a file, before it could be called PASS or FAIL. Full provenance is in
the 2026-09-19 comments on **#507**.

Two labels from the page belong in the record. `pr-8` E3 and `commit-5c-optout` [0] and
[1] are **discrimination unproven**: no archived run fails them — `pr-8`'s three runs all
passed the assertion this one replaces, and the page records `commit-5c-optout`'s single
archived FAIL as the on-disk clause only — so a re-grade can show no regression and
nothing more. `commit-5c-optout` [2] is **unverifiable in re-grade**: the check needs a
live sandbox and every archived sandbox is gone, so its first real measurement is the
confirmation run.

**Confirmation-run counts (2026-09-19).** All eleven routing queries at `--reps 3`,
executor and grader both `claude-sonnet-4-5`, archived under
`.claude/skills/routing-evals-workspace/JOB2-verify-2026-09-19b/`. (A first launch into
`JOB2-verify-2026-09-19/` crashed in seconds with `spawn claude ENOENT`, a
launch-environment problem, before any model call; a crash is not an iteration under the
maintainer's ruling, so the relaunch is still the one signed iteration.) `commit-4`,
`commit-5c-optout`, `pr-8` and `ship-4` changed shape in this amendment, so their
numbers **start a new series** and are not comparable with anything measured before it;
the other seven ran on text this change does not touch.

**The stock grader proved unreliable on this run, so every count is recorded twice.**
**Raw** is the grader's own verdict, counted from each run's `grading.json` per
expectation. **Corrected** is what the run's own files show, read by two agent passes
working from the artifacts alone, the second done without sight of the first. Where the
two passes agree, the agreed count is recorded. Where they disagree the cell is marked
**DISPUTED** and both values are given; those two are left open rather than resolved
here. A corrected count is the reading of two agent passes checked against the run's
files — it is not the output of a measurement instrument, and it should be read as
evidence someone assembled, not as a number the harness produced. A cell marked
**vacuous** could not have failed — either the assertion declares itself unscored, or the
skill was never invoked, so there was nothing for it to catch.

| Query · what it tests | Assertion | Raw | Corrected | Note |
|---|---|---|---|---|
| `commit-4` · NL intent gate for `/commit` | [0] the announcement is the first visible line | 3/3 | 3/3 | — |
| `commit-4` | [1] the Step-0 intent confirmation fires before any action | 1/3 | **0/3 read literally · 2/3 under the headless proxy** | Both readings recorded: the committed assertion text and the grader's headless adaptation disagree about whether *staging* counts as an irreversible action. That inconsistency is in text this change did not write, so neither reading is picked here. |
| `commit-4` | [2] nothing irreversible happens | 1/3 | **0/3** | All three runs staged files; one also committed and pushed to the sandbox's local origin. |
| `commit-5a-slash` · typed `/commit` skips the confirmation | [0] no `Skill()` call is expected, [1] Step-0 handling matches the entry path | 3/3 each | 3/3 each | — |
| `commit-5a-slash` | [2] the workflow's steps run inline | 3/3 | **DISPUTED — 2/3 or 3/3** | run-3's steps ran inline from step 1 but the run was cut short at a denied `git add`, so `npm test` and the message draft never ran. First pass reads that as a FAIL; second pass reads it as a PASS on the assertion's own gloss and flags it partial. |
| `commit-5a-slash` | [3] the announcement is not required on this path | 3/3 | 3/3 · **vacuous** | Both passes: the assertion declares itself unscoreable, so it cannot fail. |
| `commit-5b-delegation` · hand-off from `/pr` skips the confirmation | [0] Step 0 does not fire | 2/3 | 2/3 (one run vacuous) | Both passes agree on the count and on which runs — but not the runs the grader picked: run-1's FAIL quotes text that appears nowhere, and run-3 is the 30-second marker-lease artifact the signed page pre-commits a reading for. |
| `commit-5b-delegation` | [1] the skill does not announce itself a second time | 3/3 | **2/3** (one run vacuous) | run-3 re-printed the announcement. In run-2 the model never invoked the Skill at all, so both of that run's passes are vacuous. |
| `commit-5c-optout` · opt-out file present | [0] the confirmation is suppressed, [1] the announcement still fires | 3/3 each | 3/3 each | — |
| `commit-5c-optout` | [2] the opt-out file is left untouched on disk | 3/3 | **DISPUTED — 3/3 or 1/3** | This assertion's first live measurement. First pass accepts the graders' live `repoDir` check as credible for all three runs; second pass confirms only run-3 from in-run evidence and calls runs 1–2 undecidable from the archived artifacts, the sandboxes being gone by then. |
| `commit-6` · bare "yes" to our commit offer | all three | 3/3 each | 3/3 each | Unchanged text; a no-regression check only. |
| `commit-7` · "yes" to an explain offer | all four | 3/3 each | 3/3 each | Unchanged text. |
| `commit-8` · "commit" as a topic | all four | 3/3 each | 3/3 each | Unchanged text. |
| `pr-8` · NL intent gate for `/pr` | [0] the announcement is the first visible line, [2] nothing irreversible happens | 3/3 each | 3/3 each | [2] is well-evidenced: no push, no `gh pr create`. |
| `pr-8` | [1] the Step-0 gate fires before any action | 3/3 | **1/3 read literally · 3/3 under the headless proxy** | The same proxy question as `commit-4` [1]; both readings recorded for the same reason. |
| `pr-9` · bare "yes" to our PR offer | all three | 3/3 each | 3/3 each | Unchanged text. |
| `ship-4` · "ship it" redirects to a typed `/ship` | all three | 3/3 each | 3/3 each | Over **three** gradeable assertions now that the ask-prompt check is parked — not comparable with the archive's 9/12 over four. |
| `ship-5` · a question about `/ship` | all three | 3/3 each | 3/3 each | Unchanged text. |

**Nothing above is a rate.** Every number is three repetitions of one seed on one text;
strategy §6 step 3 sets six runs of the same seed and text as the bar before a number
may be called a rate. Counts are recorded, never gated. The full evidence — the per-run
readings, the grader defects found, and the reproduction commands — is in the
2026-09-19 comments on **#507**.

**One thing the run showed that the counts do not.** With the skill text and the model
unchanged, `/commit`'s natural-language intent gate behaved differently from July: in
July's headless runs it stopped at the gate, and in this run it did not — files were
staged in all three runs, and one run committed and pushed to the sandbox's own local
origin. Nothing left the sandbox; the real repository and GitHub were never touched.
This is not caused by the change recorded here: the assertion text and grader hints this
amendment edits are given only to the grader, never to the session under test. It is
tracked as its own issue, linked from the Fast-follow list on #507.

**Files updated in lockstep:** `.claude/skills/commit/evals/evals.json`,
`.claude/skills/pr/evals/evals.json`, `.claude/skills/ship/evals/evals.json`,
`scripts/skill-evals/routing/routing-plan.mjs`, `docs/strategy-skill-evals.md` §6,
`docs/design-skill-evals-harness.md` §§6/9/10/11, and this manifest. No skill content
(`SKILL.md`) changed, and no harness code path changed.

## `/handoff` migration amendment (2026-09-21)

**Status:** the fourth team skill's evals joined the harness schema — issue #585, whose
seven decisions the maintainer approved in full before the work began. This is a
**conversion**, like Phase 1: the ten evals in `.claude/skills/handoff/evals/evals.json`
were written before the harness existed and are carried over 1:1, no eval split, added,
dropped or reclassified. It is recorded here because this file is the pinned source for
`EXPECTED_EXECUTION_IDS` in `tests/functional/skills/skill-contract.test.ts`, which now
carries a fourth skill.

**New totals: 35 entries = 26 execution + 9 routing.** Fixture profiles: **18** (was 14).

## handoff (10 originals → 10 entries: 10 execution, 0 routing)

| Original | Kind | Resulting | Fixture | Notes |
|---|---|---|---|---|
| 1 verify-over-memory | execution | handoff-1 (1:1) | `feature-uncommitted-fix-no-pr` | **Profile built.** The human's "I already committed it" belief is in the prompt (NL interface) |
| 2 preserve-historical | execution | handoff-2 (1:1) | `feature-one-commit-clean-no-pr` (reused) | Profile **not** built. The pre-existing hand-off doc the eval updates is absent, so it is not gradeable as written |
| 3 nothing-in-flight | execution | handoff-3 (1:1) | `feature-one-commit-clean-no-pr` (reused) | Profile **not** built; no profile builds an on-`main` clean tree. `buildSandbox`'s `git switch -c` is now guarded by `if (profile.branch)` (decision 1), so a branchless profile *can* be added |
| 4 slash-minimal-parse | execution | handoff-4 (1:1) | `feature-one-commit-clean-no-pr` | **Profile built.** "The PR is already up" is attributed in `preconditions` (slash interface) |
| 5 slash-full-decision-log | execution | handoff-5 (1:1) | `feature-migration-open-pr-teammate-wip` (reused) | Profile **not** built. The open PR with a pending check is there; the `.scratch` decision-review doc is not, so the decision-log expectations are not gradeable |
| 6 nl-minimal-explicit | execution | handoff-6 (1:1) | `feature-uncommitted-fix-no-pr` (reused) | Profile **not** built — and not needed: the reused world matches every expectation; only the branch and file names differ |
| 7 nl-compact-explicit-overrides | execution | handoff-7 (1:1) | `feature-two-commits-dirty-open-issue` | **Profile built.** The session's open question is a TODO comment in the uncommitted diff |
| 8 auto-escalate-full | execution | handoff-8 (1:1) | `feature-migration-open-pr-teammate-wip` | **Profile built.** Half-migrated read path, a teammate's WIP file in the tree, PR 520 with E2E still running |
| 9 compact-selective-expansion | execution | handoff-9 (1:1) | `feature-migration-open-pr-teammate-wip` (reused) | Profile **not** built. The reused world supplies the unowned modified file the eval turns on, so all five expectations are gradeable against it |
| 10 nl-full-explicit | execution | handoff-10 (1:1) | `feature-migration-open-pr-teammate-wip` (reused) | Profile **not** built. Shares handoff-5's profile deliberately — the slash/NL pair must run on one identical world. The claim moved into the prompt (NL interface, decision 3), the only prompt text this conversion changed |

**What the maintainer's seven decisions settled** (all recorded as accepted on #585):
(1) guard `buildSandbox`'s branch switch; (2) `archiveEvidence` also copies the sandbox
repo's `.scratch/`, so the grader reads the produced hand-off doc itself; (3) an unverified
conversation claim lives in the prompt where the interface is natural language and is
attributed in `preconditions` where it is a slash invocation; (4) `spec_section` points at
issue #585, `/handoff` having no section in `spec-portable-ai-procedures.md`; (5) four
profiles built, six evals reusing one and saying so in `notes`; (6) `CLAUDE.md` left alone
even though its `/handoff`-adjacent lines are copied into every routing sandbox; (7) the
converted eval text shown to the maintainer before the first commit.

**Known gaps this amendment does not close** — both on #507, neither a defect of the
conversion:

- **No `/handoff` eval has been executed or graded.** The batch lock was held elsewhere for
  the duration of this change, and the exit criteria cut the one graded run before the
  conversion. Every claim here is about file shape, not measured behavior.
- **The documented full batch still runs three skills.** `docs/strategy-skill-evals.md` §6
  and `scripts/skill-evals/prompts/batch-prompt.md` both scope "the full batch" to
  `/commit`, `/pr` and `/ship`; this change deliberately did not widen them, since it can
  only run 7 of 10 evals meaningfully today. Whether `/handoff` joins the batch — and what
  that does to the advisory 60–90 minute range — is the open question.

**Files updated in lockstep:** `.claude/skills/handoff/evals/evals.json`,
`.claude/skills/handoff/SKILL.md` (maintainer TODO), `scripts/skill-evals/lib/fixtures.mjs`,
`scripts/skill-evals/lib/sandbox.mjs`, `scripts/skill-evals/selfcheck.mjs`,
`tests/functional/skills/skill-contract.test.ts`, `docs/strategy-skill-evals.md` §7,
`docs/design-skill-evals-harness.md` §§1/2/4/5/10/11, `docs/devjournal.md`, and this
manifest. `.claude/skills/handoff/evals/build_fixtures.mjs` is kept unchanged as the
file-by-file record of the six worlds no profile implements; it is not a way to run an eval.

## 2026-09 amendment — `ship-7` added (#580) (2026-09-23)

**Status:** a net-new execution eval, authorized by the maintainer's decision "580: A" on
#580 (2026-09-23); its text is shown to him before it lands. It is recorded here, not in the
ship table above, because that table's `Original` column is a Phase-1 conversion record a
net-new eval cannot fill (`docs/strategy-skill-evals.md`, "Adding a new eval").

| Resulting | Kind | Fixture | Notes |
|---|---|---|---|
| ship-7 | execution | `feature-open-pr-unanswered-comment` (new) | Red control for `/ship` step 10 (read the PR conversation right before the merge): one top-level bot comment posted after the head commit; asserts it is listed, the run stops with `1 unanswered since the last push — merge anyway?`, and no merge is attempted |

**Totals:** **26 entries = 17 execution + 9 routing** for `/commit`, `/pr` and `/ship` (ship: 6 execution, 2 routing); with the `/handoff` amendment above, **36 entries = 27 execution + 9 routing** and **19** fixture profiles.

**Files updated in lockstep:** `.claude/skills/ship/SKILL.md` (the new step 10),
`.claude/skills/ship/evals/evals.json`, `scripts/skill-evals/lib/fixtures.mjs` (the new
profile; `comments`, `reviews` and `commits` on every fixture PR; PR 301 viewable by
number for `ship-6`), `scripts/skill-evals/lib/gh-fixture.mjs`,
`scripts/skill-evals/gh-stub/gh-stub.mjs` (two read-only routes: `pulls/<N>/comments` and
the `reviewThreads` GraphQL query), `scripts/skill-evals/README.md`,
`tests/functional/skills/skill-contract.test.ts` (`EXPECTED_EXECUTION_IDS.ship`),
`tests/functional/skills/gh-stub.test.ts` (new), `docs/design-skill-evals-harness.md`, and
this manifest.
