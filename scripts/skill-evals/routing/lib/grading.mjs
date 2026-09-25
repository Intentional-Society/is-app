// How a grader's answer becomes (or fails to become) evidence.
//
// This module is a SEAM. `run-routing-evals.mjs` starts a real eval batch on import — it has
// no main guard — so nothing inside it can ever be unit-tested. The two decisions that settle
// whether a grading counts therefore live here, pure and importable.
//
// It imports `extractJsonObject` from `driver.mjs`, which imports `interpretGraderEnvelope`
// from here. That cycle is deliberate and safe: both bindings are hoisted function
// declarations used only at call time, never during module evaluation. Keeping the extractor
// in `driver.mjs` preserves the module surface the design doc pins.

import { extractJsonObject } from "./driver.mjs";

/**
 * Interpret one headless grader's complete stdout.
 *
 * The grader runs as `claude -p --output-format json`, so stdout is normally a session
 * ENVELOPE whose `result` string carries the verdict. This is the extraction that used to sit
 * inline in `runGrader`, plus the one field the envelope knows and the verdict does not: how
 * many turns the grader took. A grader that answered in a single turn opened no file.
 *
 * @param {string} raw - the grader child's complete stdout.
 * @returns {{grading: any, numTurns: number|null, envelopeParsed: boolean}} `grading` is the
 *   verdict object, or null when nothing parseable was found; `numTurns` is the envelope's
 *   `num_turns` when it is a finite number, else null; `envelopeParsed` says whether stdout
 *   was itself a JSON object (an envelope), as opposed to a blob we had to scan.
 */
export function interpretGraderEnvelope(raw) {
  let numTurns = null;
  try {
    const envelope = JSON.parse(raw);
    if (envelope !== null && typeof envelope === "object") {
      if (typeof envelope.num_turns === "number" && Number.isFinite(envelope.num_turns)) {
        numTurns = envelope.num_turns;
      }
      const text = typeof envelope.result === "string" ? envelope.result : raw;
      return { grading: extractJsonObject(text), numTurns, envelopeParsed: true };
    }
  } catch {
    /* not an envelope — fall through and scan the blob, exactly as before */
  }
  return { grading: extractJsonObject(raw), numTurns, envelopeParsed: false };
}

/**
 * Name the condition that voids a grading, or return null if none does.
 *
 * Three conditions, mutually exclusive by construction, each naming what was actually
 * OBSERVED rather than a fixed phrase that could misreport it:
 *  - a finite `num_turns` of 1 or less — the grader answered without opening a single file;
 *  - stdout that was not an envelope at all, so the turn count is unknowable;
 *  - an envelope that parsed but carries no numeric `num_turns`.
 *
 * @param {number|null|undefined} numTurns
 * @param {boolean|undefined} envelopeParsed
 * @returns {string|null}
 */
function voidReason(numTurns, envelopeParsed) {
  if (typeof numTurns === "number" && Number.isFinite(numTurns)) {
    return numTurns <= 1 ? `void: grader made no tool calls (num_turns: ${numTurns})` : null;
  }
  return envelopeParsed
    ? "void: grader turn count unknown (no num_turns in envelope)"
    : "void: grader turn count unknown (envelope unparseable)";
}

/**
 * Decide what one grading is worth: whether it may be persisted, what pass rate it
 * contributes, and — when it contributes none — why.
 *
 * A VOID grading is one whose envelope shows no evidence was gathered. It is discarded
 * symmetrically, PASS or FAIL: it writes no `grading.json` and no `timing.json`, contributes a
 * null pass rate (so `summarizeEval` counts it in `ungraded_runs` and keeps it out of the
 * mean), and carries an `error` naming which condition fired. The alternative — trusting a
 * verdict reached without reading anything — is how a zero-tool-call PASS came to sit inside a
 * reported mean (#583).
 *
 * An unextractable verdict is a DIFFERENT failure: already loud via `grader-raw.txt` and
 * `ungraded_runs`, it is left with a null `error` so `summarizeEval`'s own wording stands.
 *
 * @param {{grading?: any, numTurns?: number|null, envelopeParsed?: boolean}} [input]
 * @returns {{persistGrading: boolean, voided: boolean, passRate: number|null, error: string|null}}
 */
export function graderPersistenceDecision({ grading = null, numTurns = null, envelopeParsed = false } = {}) {
  const voided = voidReason(numTurns, envelopeParsed);
  if (voided) return { persistGrading: false, voided: true, passRate: null, error: voided };

  return {
    persistGrading: Boolean(grading),
    voided: false,
    passRate: grading ? verdictPassRate(grading) : null,
    error: null,
  };
}

/**
 * The pass rate from the per-expectation verdicts, not the grader's own `summary` block, which
 * can disagree with them (commit-6: 22/24 by verdicts, 23/24 by summary; #608). Only
 * `passed === true` counts as a pass; any other value counts as a fail and is logged. No
 * verdicts at all gives null, so the run is counted as ungraded rather than guessed.
 * @param {any} grading
 * @returns {number|null}
 */
function verdictPassRate(grading) {
  const verdicts = Array.isArray(grading.expectations) ? grading.expectations : [];
  if (verdicts.length === 0) {
    console.warn("[grading] no per-expectation verdicts; pass rate left null (ungraded)");
    return null;
  }
  let passed = 0;
  verdicts.forEach((v, i) => {
    if (v?.passed === true) passed++;
    else if (v?.passed !== false) {
      console.warn(
        `[grading] expectation ${i + 1} (${JSON.stringify(v?.text ?? "")}) has passed=${JSON.stringify(v?.passed)}; counted as failed`,
      );
    }
  });
  return passed / verdicts.length;
}
