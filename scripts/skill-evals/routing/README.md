# Routing session-runner (Phase 8)

Automates the **nine `kind: routing` evals** — the ones a sandboxed subagent can't test,
because routing is *whether/how the skill fires in a live session*, not what it does once
invoked. This runner drives a fresh headless `claude -p` session that **discovers** the
three team skills naturally and measures the routing outcome as a **trigger rate** over N
repetitions.

- **Design & rationale:** [`docs/design-skill-evals-harness.md`](../../../docs/design-skill-evals-harness.md) — §4.4 (this runner's module map), §4.6 (the routing flow), §6 (why `expectationsOverride` and `graderHint` exist), risks R4/R8 in §9.
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
Windows (constraint C2). This is our own code, so the vendored no-patching rule doesn't apply;
the async reader is the Windows-native equivalent of the "threaded pipe reader" the original design
called for ([`design-skill-evals-harness.md`](../../../docs/design-skill-evals-harness.md) §4.4).
Nested `claude -p` is verified working on this host (C5 probe, #512).

## Headless limits that shape grading

A headless `claude -p` session has four structural limits the eval author accepts. The grader is
told about the first two on every run (`runGrader` injects them); the last two are why two
`commit-5b` assertions look the way they do.

- **`AskUserQuestion` does not exist headless** (Phase-8 spike finding). Assertions phrased
  as "the Step 0 intent gate fires via AskUserQuestion" can't be a literal tool call.
  Grade the **observable proxy**: the announcement fired, the model recognized the NL
  intent gate (checked delegation marker / opt-out / slash tag), and it did **not** silently
  perform an irreversible side effect before surfacing the intent check.
- **The `ask` rule on `gh pr merge` can't prompt headless** (risk **R8**). For `ship-4`,
  assert the **observable**: no `pr merge` in `outputs/gh-calls.log` — trusted only when the
  log is non-empty (liveness; a byte-empty log is not proof). `observables.json` precomputes
  `ghLog.hasPrMerge` / `ghLog.live`.
- **`.claude/` is write-protected, so clear-on-read can't be graded headless.** Deleting any file
  inside `.claude/` — including `.claude/.nl-delegation-active`, which `/commit` and `/pr` delete
  on read at Step 0 — is refused by built-in Claude Code protection, with no prompter to approve
  it. Sandbox `permissions.allow` can't lift it: an untrusted workspace ignores those entries
  silently (#531). **Consequence:** `commit-5b`'s marker-deletion assertion was removed from the
  automated eval (#527, PR #530) and is covered by the manual runbook in
  `docs/strategy-skill-evals.md` §6. Never read a failed deletion in a headless run as a skill
  defect.
- **The 30s delegation-marker lease is a latent timing risk, not an observed failure.** Setup files
  are written before the executor starts, so a model could in principle generate through the seeded
  turns before Step 0 reads the marker. On `commit-5b`'s current seed the marker has been read
  fresh in every observed run; stale reads appear only in artifacts from superseded seed shapes.
  **Consequence:** treat a stale read on the current seed as a real finding worth a ticket, and do
  not add a grader branch excusing a failure as staleness.

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
      input.jsonl                # the seeded turns fed to claude -p (ground truth)
      seeded-turns.md            # those turns rendered — the same text inlined into the
                                 #   grader's prompt, so seed-presence claims come from
                                 #   ground truth rather than inference (#527)
      raw.jsonl                  # full stream-json event stream
      executor.err               # the executor child's stderr
      transcript.md              # the graded (last) turn, rendered for the grader
      timing.json                # wall-clock, written by the runner (not the grader)
      outputs/                   # archived evidence triad (BEFORE teardown, ruling 3):
        gh-calls.log             #   what the skill asked GitHub to do
        git-state.txt            #   raw sandbox git dump
        gh-stub-state.json       #   stub durable state (merge records)
        observables.json         #   script-checkable routing observables
      grading.json               # grader output (per agents/grader.md); if the grade could
                                 #   not be parsed, grader-raw.txt appears instead and the
                                 #   run is counted as ungraded
  routing_summary.json           # per-eval TRIGGER RATES across the reps
  benchmark.json / benchmark.md  # aggregate_benchmark.py output
```

`routing_summary.json` reports, per eval:

- `polarity` — one of three values, from `lib/summary.mjs`'s `polarityFor()`: `should-fire`,
  `should-NOT-fire` (the four over-trigger controls), or `should-fire-inline`.
- `invocation_trigger_rate` — the fraction of reps in which a `Skill()` call for that skill was
  observed. High for `should-fire`, ~0 for `should-NOT-fire`, and **`null` for
  `should-fire-inline`**. A typed `/commit` is expanded by the Claude Code CLI's own slash parser
  and injected directly, so no `Skill()` call is ever made and the rate is structurally 0 —
  reporting it as 0 made the summary read "broken" for correct behavior, which is what produced
  #528. `null` keeps a meaningless ratio out of the report.
- `graded_runs` / `ungraded_runs` / `ungraded[]` — a run whose grade could not be parsed is
  **counted and named**, never silently dropped. The mean is taken over graded runs only, so a
  non-zero `ungraded_runs` beside it is what stops a batch quietly shedding failing reps and
  reporting a flattering number (#527). The runner prints a warning for each.
- `mean_expectation_pass_rate` — mean graded pass rate, `null` if nothing graded.

Routing is probabilistic (risk R5) — rates, never a single binary verdict, and never a threshold.

## Grading

Each run's transcript + the eval's committed `expectations` go to a headless grader
(`claude -p`) that follows `agents/grader.md` verbatim, plus the two headless adaptations
above. The grader prints the standard grading JSON; the runner writes it to `grading.json`.
Merge-adjacent negatives follow the merge-discrimination rule (strategy §6): grade from the
transcript's tool-call record, corroborated by the call log's liveness.

The runner's pure functions — `extractJsonObject`, `renderInputTurns`, `summarizeEval`,
`polarityFor` — are unit-tested in `tests/functional/skills/routing-harness.test.ts`, one case per
defect found in the #527/#528 review. It rides the existing `functional-skills` Vitest project, so
it runs in the required `Lint & Functional Tests` check with no config or workflow change.
