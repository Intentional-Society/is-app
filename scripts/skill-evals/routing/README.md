# Routing session-runner (Phase 8)

Automates the **nine `kind: routing` evals** — the ones a sandboxed subagent can't test,
because routing is *whether/how the skill fires in a live session*, not what it does once
invoked. This runner drives a fresh headless `claude -p` session that **discovers** the
three team skills naturally and measures the routing outcome as a **trigger rate** over N
repetitions.

- **Design & rationale:** [`docs/spec-skill-evals-baseline.md`](../../../docs/spec-skill-evals-baseline.md) §II.4 (Phase-8 sketch), §II.2e, risks R4/R8.
- **How routing evals fit the workflow:** [`docs/strategy-skill-evals.md`](../../../docs/strategy-skill-evals.md) §6.
- The nine evals themselves live at `.claude/skills/{commit,pr,ship}/evals/evals.json` (`kind: routing`).

## The idea

Routing can't be tested by handing a subagent the skill path — the skill has to be
*found*. So each run:

1. builds a disposable sandbox (`make-sandbox`) and **copies the routing context in** —
   the three `SKILL.md` files, the real `CLAUDE.md` "AI Skills" section (verbatim), and
   `.claude/settings.json` (the `gh pr merge` `ask` rule) — so a fresh `claude -p` in that
   sandbox discovers and routes to the skills exactly as a real session would;
2. drives the session with the scenario's **seeded turns** and grades the outcome.

Two scenario shapes:

- **Single-turn** (`commit-4`, `commit-5a/b/c`, `commit-8`, `pr-8`, `ship-4`, `ship-5`):
  one user message (`"let's commit this"`, `"ship it"`, …).
- **Multi-turn** — the "assistant offers, human says yes" cases (`commit-6`, `commit-7`,
  `pr-9`; risk **R4**, validated by the Phase-8 kickoff spike): a synthetic prior
  **assistant offer** is seeded via `--input-format stream-json`, then the bare
  affirmation (`"yes, go ahead"`) is sent. The runner grades the **last turn** (the
  response to the affirmation).

`commit-5` expands to three sub-queries (slash / delegation / opt-out) per the conversion
manifest — the splitting rule is execution-only, but the runbook (and this runner)
enumerate its three sub-scenarios as distinct queries.

## Windows-native by construction

The child `claude -p` stdout is consumed via async stream events (the Node event loop),
never `select.select()` — the vendored `run_eval.py`'s `select()` crashes on native
Windows (spec C2). This is our own code, so the vendored no-patching rule doesn't apply;
the async reader is the Windows-native equivalent of the "threaded pipe reader" the spec
calls for. Nested `claude -p` is verified working on this host (C5 probe, #512).

## Two headless-observability adaptations (grading)

A headless `claude -p` session has two structural limits the eval author accepts. The
grader is told about both:

- **`AskUserQuestion` does not exist headless** (Phase-8 spike finding). Assertions phrased
  as "the Step 0 intent gate fires via AskUserQuestion" can't be a literal tool call.
  Grade the **observable proxy**: the announcement fired, the model recognized the NL
  intent gate (checked delegation marker / opt-out / slash tag), and it did **not** silently
  perform an irreversible side effect before surfacing the intent check.
- **The `ask` rule on `gh pr merge` can't prompt headless** (spec **R8**). For `ship-4`,
  assert the **observable**: no `pr merge` in `outputs/gh-calls.log` — trusted only when the
  log is non-empty (liveness; a byte-empty log is not proof). `observables.json` precomputes
  `ghLog.hasPrMerge` / `ghLog.live`.

## Usage

```sh
# List the query plan (11 queries: 9 evals, commit-5 → 3 sub-queries).
node scripts/skill-evals/routing/run-routing-evals.mjs --list

# Run one or a few queries, single rep (fast smoke).
node scripts/skill-evals/routing/run-routing-evals.mjs --only commit-6,ship-4 --reps 1

# Full batch: all nine routing evals, N=3 repetitions (upstream default).
node scripts/skill-evals/routing/run-routing-evals.mjs --reps 3
```

Flags: `--only <id,id>`, `--reps N` (default 3), `--model <m>` (default
`claude-sonnet-4-5`), `--out <dir>`, `--keep-sandboxes` (debug — skips teardown),
`--list`.

## Output

Run artifacts land in the gitignored workspace
`.claude/skills/routing-evals-workspace/<timestamp>/`, in the **standard** benchmark
layout so `aggregate_benchmark.py` and the eval viewer work unchanged:

```
<workspace>/
  eval-<queryId>/
    eval_metadata.json           # eval_id, source_eval, fixture, expectTrigger
    with_skill/run-<k>/
      input.jsonl                # the seeded turns fed to claude -p
      raw.jsonl                  # full stream-json event stream
      transcript.md             # the graded (last) turn, rendered for the grader
      outputs/                   # archived evidence triad (BEFORE teardown, ruling 3):
        gh-calls.log             #   what the skill asked GitHub to do
        git-state.txt            #   raw sandbox git dump
        gh-stub-state.json       #   stub durable state (merge records)
        observables.json         #   script-checkable routing observables
      grading.json               # grader output (per agents/grader.md)
  routing_summary.json           # per-eval TRIGGER RATES across the reps
  benchmark.json / benchmark.md  # aggregate_benchmark.py output
```

`routing_summary.json` reports, per eval: `invocation_trigger_rate` (fraction of reps the
skill fired — should be high for positives, ~0 for negative controls) and
`mean_expectation_pass_rate` (mean graded pass rate). Routing is probabilistic (spec R5) —
rates, never a single binary verdict.

## Grading

Each run's transcript + the eval's committed `expectations` go to a headless grader
(`claude -p`) that follows `agents/grader.md` verbatim, plus the two headless adaptations
above. The grader prints the standard grading JSON; the runner writes it to `grading.json`.
Merge-adjacent negatives follow the merge-discrimination rule (strategy §6): grade from the
transcript's tool-call record, corroborated by the call log's liveness.
