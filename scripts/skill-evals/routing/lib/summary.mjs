// Per-eval aggregation for the routing runner. Extracted from run-routing-evals.mjs so it can
// be unit-tested — that script executes on import, so it can never be pulled into a test.

/** Over-trigger controls: the skill must NOT fire at all. */
export const NEGATIVE_CONTROLS = new Set(["commit-7", "commit-8", "ship-4", "ship-5"]);

/**
 * Evals where the skill fires INLINE rather than through the `Skill` tool. A typed `/commit` is
 * expanded by the Claude Code CLI's own slash parser and injected directly into context, so no
 * `Skill()` call is ever observed and `invocation_trigger_rate` is structurally 0. Labelling
 * those `should-fire` made the summary read "0%, broken" for correct behavior — which is what
 * produced #528 in the first place.
 */
export const INLINE_FIRE = new Set(["commit-5a-slash"]);

/** Three-way polarity: inline-fire is neither a should-fire nor an over-trigger control. */
export function polarityFor(queryId) {
  if (INLINE_FIRE.has(queryId)) return "should-fire-inline";
  return NEGATIVE_CONTROLS.has(queryId) ? "should-NOT-fire" : "should-fire";
}

/**
 * Aggregate one eval's repetitions.
 *
 * Runs whose grade could not be parsed are counted and named in `ungraded`, never silently
 * dropped. The mean is still taken over graded runs only — you cannot average a result you do
 * not have — but `ungraded_runs` sits beside it so a batch cannot quietly shed failing reps and
 * report a flattering number (#527 SDET review). Callers should surface a non-zero
 * `ungraded_runs` loudly.
 */
export function summarizeEval({ queryId, evalId, skill, reps, perRep }) {
  const inlineFire = INLINE_FIRE.has(queryId);
  const invokedCount = perRep.filter((r) => r.invoked).length;
  const graded = perRep.filter((r) => typeof r.passRate === "number");
  const ungraded = perRep.filter((r) => typeof r.passRate !== "number");

  return {
    eval_id: queryId,
    source_eval: evalId,
    skill,
    polarity: polarityFor(queryId),
    reps,
    // Structurally 0 for inline-fire evals; null keeps a meaningless ratio out of the report.
    invocation_trigger_rate: inlineFire ? null : reps ? invokedCount / reps : 0,
    invoked_count: invokedCount,
    graded_runs: graded.length,
    ungraded_runs: ungraded.length,
    ungraded: ungraded.map((r) => ({ run: r.run, reason: r.error ?? "grade could not be parsed" })),
    mean_expectation_pass_rate: graded.length ? graded.reduce((a, r) => a + r.passRate, 0) / graded.length : null,
    runs: perRep,
  };
}

/** One-line console rendering for an eval summary. */
export function formatSummaryLine(e) {
  const rate = e.invocation_trigger_rate == null ? "n/a" : `${(e.invocation_trigger_rate * 100).toFixed(0)}%`;
  const pass = e.mean_expectation_pass_rate == null ? "n/a" : `${(e.mean_expectation_pass_rate * 100).toFixed(0)}%`;
  const warn = e.ungraded_runs > 0 ? `  ⚠ ${e.ungraded_runs} UNGRADED` : "";
  return `${e.eval_id.padEnd(22)} ${e.polarity.padEnd(18)} invoked ${rate} · mean pass ${pass}${warn}`;
}
