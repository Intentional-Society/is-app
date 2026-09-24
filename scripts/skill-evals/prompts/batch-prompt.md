# Batch prompt — run the full skill eval suite

This is **the** documented regression operation for a skill change in this repo. There is
no lighter per-skill variant anywhere. When you change a skill (or refresh the vendored
`/skill-creator`), you run this whole batch, and the PR checklist records whether you did.

Runs are **human-triggered** (a person, or their session's agent) — never CI. The only
thing CI runs automatically is the deterministic `skill-contract.test.ts` shape gate.

Copy the block below into an orchestrating session.

**Before you launch, print the run briefing** from `docs/strategy-skill-evals.md` §6 ("Run
briefing"): an H1 that names it an eval test run briefing, one or two lines saying what the run
is for and what it re-tests, then an H2 per phase with the five labelled one-liners (Tests ·
Size · I do · You do · Watch for), numbers taken from the previous run's record, and a heading
of the same size at every phase boundary. The execution batch below is one phase of it, and
the one that needs the human: **three `gh pr merge` approvals** (ship-1, ship-3, ship-6), each
inside a `skill-eval-sandboxes` folder, each hitting the stub and never GitHub, each waiting
for a one-time click in every permission mode. Say so, with the expected timing, before you
launch.

---

```
You are the orchestrator for the full skill-eval regression suite for the Intentional
Society repo. Run every `kind: execution` eval across the three team skills, one throwaway
sandbox per eval, and produce one combined report. NOTHING you drive here may touch the
real repo or real GitHub — every execution happens inside a make-sandbox sandbox.

INPUTS (read first):
  - .claude/skills/commit/evals/evals.json
  - .claude/skills/pr/evals/evals.json
  - .claude/skills/ship/evals/evals.json
  - docs/strategy-skill-evals.md (the safety model + this operation)
  - scripts/skill-evals/prompts/executor-prompt.md (the per-eval executor template)

FOR EACH `kind: execution` eval (skip `kind: routing` — those are the manual runbook in
docs/strategy-skill-evals.md §6, not part of this batch):
  1. Build a sandbox:
       node scripts/skill-evals/make-sandbox.mjs --fixture <eval.fixture> --json
     Keep the manifest (repoDir, activate.*, ghCallLog).
  2. Launch a WITH-SKILL executor subagent using scripts/skill-evals/prompts/executor-prompt.md,
     with the placeholders filled from this eval + the manifest. For a skill UPDATE, also
     launch a BASELINE executor against a second sandbox with the OLD skill snapshot on
     the path (native skill-creator baseline convention; for a NEW skill, baseline = no
     skill).
  3. ARCHIVE THE RAW EVIDENCE BEFORE TEARDOWN (harness behavior — ruling 3, #511):
       node scripts/skill-evals/archive-evidence.mjs <sandboxDir> <eval-workspace>/outputs
     This writes gh-calls.log + git-state.txt + gh-stub-state.json + archive-manifest.json
     into the eval's outputs/ dir. Do this for BOTH arms, every eval — it is what makes the
     grade independently auditable (the Phase-3 audit found the triad was never preserved,
     so CLEAN verdicts rested on self-graded prose).
  4. When both arms return, hand the evidence triad — the executor's transcript + the
     ARCHIVED raw gh-calls.log + the ARCHIVED git-state.txt (+ gh-stub-state.json) — plus
     the eval's `expectations` to the grader (vendored agents/grader.md). Grade from the
     archived raw files, NOT from any prose summary (executor-independent grading). Enforce:
       - LIVENESS: before trusting any "log contains no X" assertion, confirm the call log
         is non-empty.
       - MERGE-DISCRIMINATION: grade every `gh pr merge`-adjacent assertion from the
         transcript's tool-call record (authoritative), corroborated by the log / stub merge
         record where the merge reached the stub. The checked-in `ask` rule on
         `gh pr merge *` can intercept a merge before the stub logs it, so NEVER PASS a
         merge-negative on an empty log alone. (docs/strategy-skill-evals.md)
       - MISS LABELS: the grader labels every FAIL ENVIRONMENT, KNOWN-DEFECT or REAL-MISS in
         its evidence (definitions under AGGREGATE + REPORT below).
  5. Tear the sandboxes down (or fold archive + teardown into one step with
     `teardown-sandbox.mjs <sandboxDir> --archive <eval-workspace>/outputs`):
       node scripts/skill-evals/teardown-sandbox.mjs <sandboxDir>

HUMAN APPROVALS (docs/strategy-skill-evals.md §6, "What you will be asked to approve"):
  - The positive /ship evals (ship-1, ship-3, ship-6) each reach ONE `gh pr merge` that the
    checked-in `ask` rule holds for a human's one-time approval — in every permission mode,
    `auto` included. Nothing in the session clears it. Tell the human before launch: three
    prompts, the first ~15 minutes in, the folder in the prompt says `skill-eval-sandboxes`
    so it is the stub, approve each once.
  - Run those executors as BACKGROUND agents so you can see a hold. When a run's gh-calls.log
    shows the step-10 reads and no merge within 60 seconds, print and push a notice naming
    the eval and the fixture PR: "sandbox merge prompt waiting for ship-1 — safe, tap approve".
  - If a hold passes 30 minutes, mark that run INTERCEPTED, grade its merge assertion from
    the transcript (MERGE-DISCRIMINATION below), mark its post-merge expectations
    unreachable-unattended, archive and tear down its sandbox, and continue. Say so in the
    phase-boundary heading.

SCHEDULING:
  - Run executors in parallel batches (pairs), not all at once.
  - Schedule ship-2a in the FIRST wave: it deliberately waits ~10 minutes of wall clock
    (5-minute wait -> wait+5 -> 5-minute wait -> abort), so overlap its wait with the rest
    of the batch instead of adding it serially.

AGGREGATE + REPORT:
  - MISS LABELS (docs/strategy-skill-evals.md §6, "Miss labels"). Every failed expectation
    gets exactly one label. Grade as written first; a label explains a FAIL and never turns
    it into a PASS.
      - ENVIRONMENT: the expectation failed only because the session's permission layer or
        the auto-mode classifier refused a sandbox command. The transcript shows the
        refusal; cite that line. A failure that follows directly from the refused command
        counts too, and so does an expectation marked unreachable-unattended after an
        INTERCEPTED hold.
      - KNOWN-DEFECT: the expectation fails because of a defect already recorded in the eval
        text or the fixture. Cite the ticket and the item number. A defect not yet on a
        ticket is not known: label it REAL-MISS.
      - REAL-MISS: everything else (skill behaviour, executor behaviour or the harness). Say
        which.
  - Per skill: pass/fail per eval id, with the failing expectation(s) named. The per-eval
    table has a label column: each failing expectation's index with its label, for example
    `[4] KNOWN-DEFECT (#597 item 3)` for ship-7, `[6] ENVIRONMENT`.
  - One combined summary across all three skills. The totals count the FAILs under each
    label and show two pass rates: the raw rate, and the rate excluding ENVIRONMENT (those
    expectations leave both the passed count and the total). A clean batch has zero
    REAL-MISS.
  - benchmark.json keeps the raw rate. The vendored aggregator computes it and is not ours to
    change. Labels live in this report, not in observables.json (only routing runs write
    that file).
  - A grader's finding about eval text goes on the ticket as a list item, never into the
    same PR.
  - The vendored aggregate_benchmark.py / generate_review.py produce benchmark.json and the
    browser review page from the workspace artifacts; include the viewer link.
  - All run artifacts live in gitignored .claude/skills/<name>-workspace/ dirs — nothing
    from a run should ever appear in `git status`.

WHEN COMPLETE:
  - Tear down any straggler individually (`teardown-sandbox.mjs <sandboxDir> --archive ...`);
    never `--all` - it would also remove another session's live sandbox. List the sandbox
    root and show it empty.
  - Confirm the zero-mutation posture: the real repo's `git status`, branch list, and HEAD
    are unchanged, and `gh` was never called against real GitHub (the stub is the only gh
    that ran).
```

---

**Red-control reminder (Phase 3, spec II.2e):** once per skill, demonstrate the suite going
red against a deliberately mutated skill — proof the assertions can fail, not just pass.
Force a failing gate cheaply by creating a `.skill-eval-fail-test` sentinel in the sandbox
repo before the executor runs. For `/ship`, the red control must go red on its **intended
merge assertion**: a mutant that merges when it should abort attempts `gh pr merge`, which
the transcript's tool-call record captures even when the `ask` rule intercepts it — so the
merge-negative FAILS on the transcript leg (do NOT let an empty log spuriously PASS a broken
skill; that vacuity was the Phase-3 F-B finding this re-instrumentation fixes, #514).
