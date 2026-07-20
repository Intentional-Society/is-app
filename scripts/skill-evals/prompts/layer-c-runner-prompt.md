# Layer-C runner prompt — description-optimization loop (platform-routed)

Layer C is the vendored `/skill-creator` **description-optimization loop** (`run_loop.py`,
which imports `run_eval.py`). It tunes a skill's frontmatter `description` for triggering
accuracy against a committed trigger-eval set. It is the one piece of vendored machinery
that **cannot run on native Windows** — `run_eval.py` calls `select.select()` on a
subprocess pipe, which raises `OSError [WinError 10093]` on Windows (spec C2, re-verified
2026-07-19). Layer C also never touches `gh`, so the known cloud-no-`gh` gap does not apply.

**Platform routing (spec II.2f):**

| Platform | How Layer C runs |
|---|---|
| **macOS / Linux** | Run the block below **directly** (needs python3 + PyYAML + a logged-in `claude` CLI). |
| **Cloud Claude Code session** | Linux, so the crash vanishes. Run the block below; **Step 0 is the C5 smoke** that confirms nested `claude -p` works in the cloud sandbox first. |
| **Cowork** | Works per the vendored SKILL.md's Cowork section. Run the block below. |
| **Windows** | **Never natively.** Hand this prompt to a cloud/Cowork session (or a Mac/Linux teammate), let it run, and take back the reported `best_description`. |

**Scope:** only `/commit` and `/pr` — the two natural-language-invocable skills. `/ship` is
`disable-model-invocation: true` (explicit-only), so description optimization does not apply
to it; its should-NOT-trigger behavior is covered by routing evals ship-4 / ship-5.

**The loop does NOT ship anything.** It reports a candidate `best_description` and train/test
scores. Any change to a skill's real `description` lands back on the author's machine through
the normal `/commit` → `/pr` flow **with maintainer sign-off**. "Retain the current
description" is an allowed, common outcome (the current descriptions were already hand-tuned
during the NL-invocation work).

Copy the block below into a session on a platform that can run Layer C. Fill `<ISSUE>` and
`<MODEL>` first.

---

```
You are running the Layer-C description-optimization loop for the Intentional Society repo's
two NL-invocable skills, /commit and /pr. You are on a Linux/macOS/Cowork/cloud platform (NOT
native Windows). You will NOT commit, push, or open any PR — you REPORT results back. All
commands run from the repo root.

ISSUE = <ISSUE>     # the phase issue to post results to (Phase 4 = 512)
MODEL = <MODEL>     # a currently-available model id/alias for BOTH the triggering claude -p
                    # calls and the description-improver, e.g. the model your team runs in
                    # Claude Code. Pass it to --model on every run_loop invocation.

INPUTS (read first):
  - .claude/skills/commit/evals/trigger-evals.json   (20 queries: 10 should-trigger, 10 not)
  - .claude/skills/pr/evals/trigger-evals.json        (20 queries: 10 should-trigger, 10 not)
  - .claude/skills/{commit,pr}/SKILL.md               (the current descriptions are the start)
  - docs/strategy-skill-evals.md §8 (this routing) and spec II.2f

PREREQ CHECKS (stop and report if any fails):
  python3 --version
  python3 -c "import yaml; print('pyyaml', yaml.__version__)"
  claude --version         # the claude CLI must be logged in on this platform

STEP 0 — C5 SMOKE (the 30-second go/no-go; do this FIRST, record the result on ISSUE):
  Confirm a nested `claude -p` works inside this sandbox. run_eval.py strips CLAUDECODE
  before spawning, so mirror that:
     env -u CLAUDECODE claude -p "Reply with exactly the token SMOKE-OK and nothing else." --model $MODEL
  PASS = it prints SMOKE-OK and exits 0 within ~30s, with no "cannot run inside Claude Code"
  nesting error. Post the exact command + output + exit code to ISSUE.
  IF THE SMOKE FAILS: Layer C is a Should (non-blocking). Record the failure on ISSUE, flag it
  (spec R6), and STOP — the fallback is Cowork or a Mac/Linux teammate. Do not force the loop.

STEP 1 — RUN THE LOOP PER SKILL (only if Step 0 passed):
  Run run_loop.py once per skill. The `scripts` package lives under the vendored skill-creator
  dir, so put it on PYTHONPATH and invoke as a module from the repo root. --skill-path is the
  skill DIRECTORY (not SKILL.md). Defaults used: holdout 0.4 (stratified train/test split),
  runs-per-query 3 (probabilistic — trigger rates), max-iterations 5, trigger-threshold 0.5.
  --results-dir archives raw artifacts (results.json, report.html, logs) — REQUIRED before any
  teardown (Blake ruling 3: archive raw evidence before teardown). --report none skips the
  browser auto-open in a headless session.

  # /commit
  PYTHONPATH=.claude/skills/skill-creator python3 -m scripts.run_loop \
    --eval-set  .claude/skills/commit/evals/trigger-evals.json \
    --skill-path .claude/skills/commit \
    --model "$MODEL" --holdout 0.4 --runs-per-query 3 --max-iterations 5 \
    --report none --results-dir .claude/skills/commit-workspace/layer-c --verbose

  # /pr
  PYTHONPATH=.claude/skills/skill-creator python3 -m scripts.run_loop \
    --eval-set  .claude/skills/pr/evals/trigger-evals.json \
    --skill-path .claude/skills/pr \
    --model "$MODEL" --holdout 0.4 --runs-per-query 3 --max-iterations 5 \
    --report none --results-dir .claude/skills/pr-workspace/layer-c --verbose

  (results-dir lives under a gitignored .claude/skills/<name>-workspace/ dir — nothing here
  should ever land in git status. Keep the results.json/report.html as the raw evidence
  artifact; do not delete before reporting.)

STEP 2 — REPORT BACK TO ISSUE (per skill, both skills):
  From each run's JSON stdout (also saved to results.json), report verbatim:
    - original_description   (what shipped)
    - best_description       (the candidate the loop found)
    - best_train_score, best_test_score   (held-out train/test — the honest signal)
    - exit_reason, iterations_run, train_size, test_size
  Then a one-line recommendation per skill: APPLY best_description, or RETAIN current
  (retain is correct when best_description ≠ current does NOT beat the current on the TEST
  score — the loop reports best by test score; a tie or no-gain means retain).
  Post all of this to ISSUE as a comment. Do NOT edit any SKILL.md, do NOT commit, do NOT PR.

HAND-BACK: the author takes best_description (if recommended) back to their machine and lands
it via the normal /commit + /pr flow with maintainer sign-off. The maintainer signs off on
the description change; "retain current" needs no change.
```

---

**Why report-only:** the platform that can run Layer C (cloud/Cowork/mac) is often not the
platform where the author works, and the skills are self-hosting — a description change is a
one-line SKILL.md frontmatter edit that must go through the same guarded `/commit` → `/pr`
review as any other skill change, on the author's machine, with the maintainer's sign-off.

**Interpreting the scores (spec II.2e):** triggering is probabilistic — `runs-per-query 3`
means each query fires the skill up to 3 times and the pass threshold is a *rate*
(≥ `trigger-threshold`). The **test** score (held-out set the improver never sees — see the
`blinded_history` in run_loop.py) is the overfitting guard: prefer a description that holds up
on test, not one that only wins on train.
