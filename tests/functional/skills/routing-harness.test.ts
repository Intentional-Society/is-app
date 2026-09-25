import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { REPO_ROOT } from "../../../scripts/skill-evals/routing/lib/context.mjs";
import {
  DEFAULT_MODEL,
  extractJsonObject,
  graderSpawnSpec,
  modelUnavailableMessage,
  sandboxEnv,
} from "../../../scripts/skill-evals/routing/lib/driver.mjs";
import {
  graderPersistenceDecision,
  interpretGraderEnvelope,
} from "../../../scripts/skill-evals/routing/lib/grading.mjs";
import { polarityFor, summarizeEval } from "../../../scripts/skill-evals/routing/lib/summary.mjs";
import { renderInputTurns, routingObservables } from "../../../scripts/skill-evals/routing/lib/transcript.mjs";

// Pure-function coverage for the routing eval harness. Each case below corresponds to a defect
// found during the #527/#528 independent review, where a silent failure produced a flattering
// or fabricated result rather than a loud one.

describe("extractJsonObject", () => {
  it("parses grader JSON containing an unescaped Windows path", () => {
    // The grader quotes evidence verbatim; `\.` is not a legal JSON escape, so this threw and
    // the whole run was dropped from the mean without failing anything.
    const raw = String.raw`{"summary":{"pass_rate":0.75},"evidence":"ran Remove-Item .claude\.nl-delegation-active"}`;
    expect(extractJsonObject(raw)?.summary?.pass_rate).toBe(0.75);
  });

  // REGRESSION GUARD: the original repair used a regex lookahead, which matched the SECOND
  // backslash of an already-valid `\\` pair and produced `\\\`. Evidence mixing a real Windows
  // path with an invalid escape — the realistic shape — therefore still failed. A fixture
  // carrying only invalid escapes passes against both the broken and fixed code, which is how
  // the defect shipped past the first version of this file.
  it("parses evidence mixing valid escaped backslashes with an invalid escape", () => {
    const raw = String.raw`{"summary":{"pass_rate":0},"evidence":"ran Remove-Item C:\\repo\\.claude\\.nl-delegation-active then \.foo"}`;
    const parsed = extractJsonObject(raw);
    expect(parsed?.summary?.pass_rate).toBe(0);
    expect(parsed?.evidence).toContain(String.raw`C:\repo\.claude\.nl-delegation-active`);
  });

  it("preserves a \\uXXXX escape while repairing an invalid one alongside it", () => {
    const raw = String.raw`{"u":"A","w":"a\.b"}`;
    expect(extractJsonObject(raw)?.u).toBe("A");
  });

  it("prefers a fenced json block over a stray brace in prose", () => {
    const raw = 'My verdict {inconclusive}.\n\n```json\n{"summary":{"pass_rate":1}}\n```\n';
    expect(extractJsonObject(raw)?.summary?.pass_rate).toBe(1);
  });

  it("still parses a plain unfenced object", () => {
    expect(extractJsonObject('{"a":1}')?.a).toBe(1);
  });

  it("returns null when there is genuinely nothing parseable", () => {
    expect(extractJsonObject("{{{ not json at all")).toBeNull();
    expect(extractJsonObject("no braces here")).toBeNull();
  });
});

describe("sandboxEnv", () => {
  // REGRESSION GUARD (#582): a PowerShell-launched process carries the search path under the key
  // `Path`, so reading `env.PATH` returned undefined and the child's path became the stub folder
  // alone — the real path holding `claude.exe` was gone, and every run died with
  // `spawn claude ENOENT` before any model call. The base env is injected rather than read from
  // `process.env` so the case-variant lives in the fixture: an ambient-only test would be red on
  // one person's shell and green on CI (ubuntu-latest always exports `PATH`).
  const STUB = "/sandbox/bin";
  const manifest = { binDir: STUB, repoDir: "/sandbox/repo", env: { prependPath: STUB } };
  const pathKeys = (env: Record<string, string | undefined>) => Object.keys(env).filter((k) => /^path$/i.test(k));

  it("keeps the real search path when the base env spells it `Path` (PowerShell)", () => {
    const env = sandboxEnv(manifest, { Path: "/usr/bin" });
    expect(env.PATH).toBe(`${STUB}${path.delimiter}/usr/bin`);
    expect(pathKeys(env)).toEqual(["PATH"]);
  });

  it("keeps the real search path when the base env spells it `PATH` (bash)", () => {
    const env = sandboxEnv(manifest, { PATH: "/usr/bin" });
    expect(env.PATH).toBe(`${STUB}${path.delimiter}/usr/bin`);
    expect(pathKeys(env)).toEqual(["PATH"]);
  });

  it("leaves no trailing separator when the base env has no search path at all", () => {
    const env = sandboxEnv(manifest, { HOME: "/home/x" });
    expect(env.PATH).toBe(STUB);
  });

  it("collapses both case-variants onto one `PATH`, with the exact-case value winning", () => {
    const env = sandboxEnv(manifest, { Path: "/lower", PATH: "/upper" });
    expect(pathKeys(env)).toEqual(["PATH"]);
    expect(env.PATH).toBe(`${STUB}${path.delimiter}/upper`);
  });
});

// The real thing (#583): a `ship-5` re-grade of 2026-09-19 in which the grader answered in ONE
// turn — it opened no file, read no transcript — and returned a clean 3/3 PASS that fed straight
// into the eval's mean. Trimmed to the fields the decision reads; the byte-for-byte original is
// preserved in the issue.
const ZERO_TOOL_CALL_ENVELOPE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 1,
  permission_denials: [],
  stop_reason: "end_turn",
  result:
    '```json\n{"expectations":[{"text":"…","passed":true}],"summary":{"passed":3,"failed":0,"total":3,"pass_rate":1.0}}\n```',
});

describe("interpretGraderEnvelope", () => {
  // CHARACTERISATION: pins the extraction that used to sit inline in runGrader, so moving it to
  // the seam is provably a move and not a rewrite.
  it("pulls the verdict out of an ordinary envelope and reports its turn count", () => {
    const raw = JSON.stringify({
      type: "result",
      num_turns: 9,
      result: '```json\n{"summary":{"passed":2,"failed":1,"total":3,"pass_rate":0.6667}}\n```',
    });
    const interpreted = interpretGraderEnvelope(raw);
    expect(interpreted.grading?.summary?.pass_rate).toBe(0.6667);
    expect(interpreted.numTurns).toBe(9);
    expect(interpreted.envelopeParsed).toBe(true);
  });

  it("falls back to scanning the blob when stdout is not an envelope at all", () => {
    const interpreted = interpretGraderEnvelope('chatter first.\n\n```json\n{"summary":{"pass_rate":0.5}}\n```\n');
    expect(interpreted.grading?.summary?.pass_rate).toBe(0.5);
    expect(interpreted.envelopeParsed).toBe(false);
    expect(interpreted.numTurns).toBeNull();
  });

  it("reports no turn count when a parsed envelope omits num_turns", () => {
    const raw = JSON.stringify({ type: "result", result: '{"summary":{"pass_rate":1}}' });
    const interpreted = interpretGraderEnvelope(raw);
    expect(interpreted.grading?.summary?.pass_rate).toBe(1);
    expect(interpreted.envelopeParsed).toBe(true);
    expect(interpreted.numTurns).toBeNull();
  });

  it("reads the real zero-tool-call envelope as a clean PASS taken in one turn", () => {
    const interpreted = interpretGraderEnvelope(ZERO_TOOL_CALL_ENVELOPE);
    expect(interpreted.grading?.summary?.pass_rate).toBe(1);
    expect(interpreted.numTurns).toBe(1);
  });
});

describe("graderPersistenceDecision", () => {
  // Verdicts matching each summary: since #608 the pass rate is computed from the verdicts.
  const verdicts = (passed: boolean) => [1, 2, 3].map((n) => ({ text: `e${n}`, passed }));
  const passing = { expectations: verdicts(true), summary: { passed: 3, failed: 0, total: 3, pass_rate: 1.0 } };
  const failing = { expectations: verdicts(false), summary: { passed: 0, failed: 3, total: 3, pass_rate: 0 } };

  // THE DEFECT (#583): this exact input — a parsed PASS from a grader that took one turn —
  // counted as full evidence and carried pass_rate 1.0 into the mean.
  it("voids a one-turn grading: no persistence, no pass rate, a named reason", () => {
    const { grading, numTurns, envelopeParsed } = interpretGraderEnvelope(ZERO_TOOL_CALL_ENVELOPE);
    const decision = graderPersistenceDecision({ grading, numTurns, envelopeParsed });
    expect(decision.passRate).toBeNull(); // the harm: 1.0 used to reach the mean
    expect(decision.persistGrading).toBe(false);
    expect(decision.voided).toBe(true);
    expect(decision.error).toBe("void: grader made no tool calls (num_turns: 1)");
  });

  it("voids on the turn count alone, with nothing else known", () => {
    const decision = graderPersistenceDecision({ numTurns: 1 });
    expect(decision.voided).toBe(true);
    expect(decision.passRate).toBeNull();
  });

  // The rule is mechanical and symmetric — a void FAIL is no more evidence than a void PASS.
  it("voids a one-turn FAIL exactly as it voids a one-turn PASS", () => {
    const decision = graderPersistenceDecision({ grading: failing, numTurns: 1, envelopeParsed: true });
    expect(decision.voided).toBe(true);
    expect(decision.passRate).toBeNull();
    expect(decision.error).toBe("void: grader made no tool calls (num_turns: 1)");
  });

  it("voids a grading whose envelope never parsed, naming that condition", () => {
    const decision = graderPersistenceDecision({ grading: passing, numTurns: null, envelopeParsed: false });
    expect(decision.voided).toBe(true);
    expect(decision.error).toBe("void: grader turn count unknown (envelope unparseable)");
  });

  it("voids a grading whose parsed envelope carries no numeric num_turns", () => {
    const decision = graderPersistenceDecision({ grading: passing, numTurns: null, envelopeParsed: true });
    expect(decision.voided).toBe(true);
    expect(decision.error).toBe("void: grader turn count unknown (no num_turns in envelope)");
  });

  it("keeps an ordinary multi-turn grading and its pass rate", () => {
    const decision = graderPersistenceDecision({ grading: passing, numTurns: 6, envelopeParsed: true });
    expect(decision.voided).toBe(false);
    expect(decision.persistGrading).toBe(true);
    expect(decision.passRate).toBe(1);
    expect(decision.error).toBeNull();
  });

  // An unparseable verdict was already loud (grader-raw.txt + ungraded_runs). It is a different
  // failure from a void one, and must not borrow the void wording.
  it("leaves an unextractable verdict ungraded without calling it void", () => {
    const decision = graderPersistenceDecision({ grading: null, numTurns: 6, envelopeParsed: true });
    expect(decision.voided).toBe(false);
    expect(decision.persistGrading).toBe(false);
    expect(decision.passRate).toBeNull();
    expect(decision.error).toBeNull();
  });
});

describe("renderInputTurns", () => {
  let tmp: string;
  const write = (name: string, body: string) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, body);
    return p;
  };
  const turn = (role: string, text: string) => JSON.stringify({ message: { role, content: [{ type: "text", text }] } });

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "routing-harness-test-"));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reports a missing file as unverifiable", () => {
    expect(renderInputTurns(path.join(tmp, "absent.jsonl")).found).toBe(false);
  });

  it("reports an empty file as unverifiable rather than asserting no seed", () => {
    const result = renderInputTurns(write("empty.jsonl", ""));
    expect(result.found).toBe(false);
    expect(result.markdown).toContain("CANNOT be verified");
    // The fabricated negative this guard exists to prevent.
    expect(result.markdown).not.toContain("Seeded prior turns: NONE");
  });

  it("reports a wholly unparseable file as unverifiable", () => {
    expect(renderInputTurns(write("corrupt.jsonl", "not json\nalso not json\n")).found).toBe(false);
  });

  // REGRESSION GUARD: a legitimate single-turn eval also yields zero seeded turns. Guarding on
  // `seeded.length` instead of `turns.length` would misreport every single-turn eval
  // (commit-5a, commit-8, ship-4, ship-5, pr-8) as unverifiable.
  it("treats a legitimate single-turn eval as verified with no seeded turns", () => {
    const result = renderInputTurns(write("single.jsonl", `${turn("user", "/commit fix the redirect")}\n`));
    expect(result.found).toBe(true);
    expect(result.seeded).toHaveLength(0);
    expect(result.markdown).toContain("Seeded prior turns: NONE");
  });

  it("renders seeded turns and the final trigger turn for a multi-turn eval", () => {
    const body = [
      turn("user", "I edited the handler."),
      turn("assistant", "Using /commit — delegated from /pr"),
      turn("user", "go ahead"),
    ].join("\n");
    const result = renderInputTurns(write("multi.jsonl", `${body}\n`));
    expect(result.found).toBe(true);
    expect(result.seeded).toHaveLength(2);
    expect(result.trigger?.text).toBe("go ahead");
  });
});

describe("summarizeEval", () => {
  const base = { evalId: "commit-5", skill: "commit" };

  it("counts and names ungraded runs instead of silently dropping them", () => {
    const summary = summarizeEval({
      ...base,
      queryId: "commit-5b-delegation",
      reps: 3,
      perRep: [
        { run: 1, invoked: true, passRate: 1 },
        { run: 2, invoked: true, passRate: 0 },
        { run: 3, invoked: true, error: "grader JSON unparseable" },
      ],
    });
    expect(summary.ungraded_runs).toBe(1);
    expect(summary.graded_runs).toBe(2);
    expect(summary.ungraded[0].run).toBe(3);
    expect(summary.mean_expectation_pass_rate).toBe(0.5);
    expect(summary.runs).toHaveLength(3);
  });

  // CONTRACT GUARD (#583): decision 3a nulls a void run's pass rate at the decision seam, so the
  // void row reaches summarizeEval looking like any other ungraded row. This pins that the two
  // halves fit: a voided run must leave graded_runs at 0 and carry its reason through.
  it("treats a voided run as ungraded and carries the void reason through", () => {
    const summary = summarizeEval({
      ...base,
      queryId: "ship-5",
      reps: 1,
      perRep: [{ run: 1, invoked: false, passRate: null, error: "void: grader made no tool calls (num_turns: 1)" }],
    });
    expect(summary.graded_runs).toBe(0);
    expect(summary.ungraded_runs).toBe(1);
    expect(summary.ungraded[0].reason).toBe("void: grader made no tool calls (num_turns: 1)");
    expect(summary.mean_expectation_pass_rate).toBeNull();
  });

  it("reports no trigger rate for inline-fire evals rather than a misleading 0%", () => {
    const summary = summarizeEval({
      ...base,
      queryId: "commit-5a-slash",
      reps: 2,
      perRep: [
        { run: 1, invoked: false, passRate: 1 },
        { run: 2, invoked: false, passRate: 1 },
      ],
    });
    expect(summary.invocation_trigger_rate).toBeNull();
    expect(summary.mean_expectation_pass_rate).toBe(1);
  });
});

describe("polarityFor", () => {
  it("distinguishes inline-fire, over-trigger controls, and ordinary should-fire evals", () => {
    expect(polarityFor("commit-5a-slash")).toBe("should-fire-inline");
    expect(polarityFor("commit-7")).toBe("should-NOT-fire");
    expect(polarityFor("commit-6")).toBe("should-fire");
  });
});

// #584: the grader used to run with cwd = the run folder, which by default lives INSIDE this
// checkout (.claude/skills/routing-evals-workspace/<stamp>/...). With Bash allowed, a `git log`
// from there walked up into the real repo, and in the 2026-09-19 batch a grader mistook the real
// repo's history for the sandbox's and produced a wrong PASS. The fix (B2c) grades from a copy
// of the run folder under the OS temp dir; these pin the two properties that decide it.
describe("graderSpawnSpec", () => {
  const isInside = (child: string, parent: string) => {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  // The runner's default run folder: inside the checkout.
  const runDir = path.join(REPO_ROOT, ".claude", "skills", "routing-evals-workspace", "stamp", "ship-5", "run-1");

  it("puts the grader's cwd under the OS temp dir, never under the repo root", () => {
    const { cwd } = graderSpawnSpec({ runDir, repoRoot: REPO_ROOT, model: "m", nonce: "n1" });
    expect(isInside(cwd, REPO_ROOT)).toBe(false);
    expect(isInside(cwd, os.tmpdir())).toBe(true);
    expect(isInside(cwd, runDir)).toBe(false);
  });

  it("keeps the allow-list Read Grep Glob Bash (B2 keeps Bash; decision 1a after a clean P1)", () => {
    const { args } = graderSpawnSpec({ runDir, repoRoot: REPO_ROOT, model: "claude-sonnet-4-5", nonce: "n1" });
    const i = args.indexOf("--allowedTools");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe("Read Grep Glob Bash");
    expect(args.slice(0, 5)).toEqual(["-p", "--output-format", "json", "--model", "claude-sonnet-4-5"]);
  });

  it("gives each grading its own directory", () => {
    const a = graderSpawnSpec({ runDir, repoRoot: REPO_ROOT, model: "m", nonce: "a" });
    const b = graderSpawnSpec({ runDir, repoRoot: REPO_ROOT, model: "m", nonce: "b" });
    expect(a.cwd).not.toBe(b.cwd);
  });

  it("refuses a temp root that resolves inside the repo", () => {
    expect(() =>
      graderSpawnSpec({ runDir, repoRoot: REPO_ROOT, model: "m", nonce: "n1", tmpRoot: path.join(REPO_ROOT, "tmp") }),
    ).toThrow(/inside the real repo/);
  });
});

// #608 A1: since #579 a merge is judged transcript-first, so the grader instruction that trusted a
// merge-negative whenever gh-calls.log was non-empty became unsound. The prompt is built inline in
// runGrader (which spawns a real grader), so this reads the source the prompt is built from.
describe("grader prompt (#608 A1)", () => {
  const driverSrc = fs.readFileSync(
    path.join(REPO_ROOT, "scripts", "skill-evals", "routing", "lib", "driver.mjs"),
    "utf8",
  );

  it("no longer tells the grader to trust a merge-negative from a non-empty log", () => {
    expect(driverSrc).not.toContain("Trust that negative");
    expect(driverSrc).not.toContain("a byte-empty log is NOT proof");
  });

  it("keeps the rest of the merge-gated bullet", () => {
    expect(driverSrc).toContain("'merge is gated' expectation, assert the OBSERVABLE: no `pr merge` appears in");
    expect(driverSrc).toContain("ghLog.hasPrMerge and ghLog.live for you; corroborate against the raw log.");
  });
});

// #608 A2: announcementPresent was a substring match over all text, so a quoted mention of the
// phrase counted as the announcement itself.
describe("routingObservables announcementPresent (#608 A2)", () => {
  const turn = (...texts: string[]) => [
    { type: "system", subtype: "init" },
    { type: "assistant", message: { content: texts.map((text) => ({ type: "text", text })) } },
  ];
  const present = (...texts: string[]) => routingObservables(turn(...texts), { skill: "commit" }).announcementPresent;

  it("counts the plain announcement at the start of a line", () => {
    expect(present("Using /commit\n\nStaging the change now.")).toBe(true);
    expect(present("Checking the tree first.\nUsing /commit")).toBe(true);
  });

  it("counts the bold announcement", () => {
    expect(present("**Using /commit**\n\nStaging the change now.")).toBe(true);
  });

  it("does not count a quoted mention inside a sentence", () => {
    expect(present('He said "Using /commit" is the phrase')).toBe(false);
  });
});

// #608 A3: the pass rate came from the grader's own summary block, which can disagree with its
// per-expectation verdicts (commit-6: 22/24 by verdicts, 23/24 by summary). Only `passed === true`
// counts as a pass.
describe("graderPersistenceDecision pass rate from verdicts (#608 A3)", () => {
  it("computes the rate from the verdicts, not the summary block", () => {
    const expectations = [
      ...Array.from({ length: 22 }, (_, i) => ({ text: `e${i + 1}`, passed: true })),
      { text: "e23", passed: false },
      { text: "e24", passed: "unverifiable" },
    ];
    const grading = { expectations, summary: { passed: 23, failed: 1, total: 24, pass_rate: 23 / 24 } };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const decision = graderPersistenceDecision({ grading, numTurns: 6, envelopeParsed: true });
      expect(decision.passRate).toBe(22 / 24);
      expect(warn.mock.calls.flat().join("\n")).toContain("e24");
    } finally {
      warn.mockRestore();
    }
  });

  it("leaves the pass rate null when there are no verdicts, ignoring the summary rate", () => {
    const grading = { summary: { passed: 3, failed: 0, total: 3, pass_rate: 1 } };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const decision = graderPersistenceDecision({ grading, numTurns: 6, envelopeParsed: true });
      expect(decision.passRate).toBeNull();
      expect(decision.voided).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

// #608 A4: the default model sat in three code sites. One exported constant, and a pre-batch
// check whose failure message says plainly what to do. The live probe is run by hand.
describe("pinned model (#608 A4)", () => {
  const routingDir = path.join(REPO_ROOT, "scripts", "skill-evals", "routing");
  const read = (...p: string[]) => fs.readFileSync(path.join(routingDir, ...p), "utf8");

  it("exports one model constant and writes the id nowhere else in the code", () => {
    expect(DEFAULT_MODEL).toBe("claude-sonnet-4-5");
    const hits = [read("lib", "driver.mjs"), read("run-routing-evals.mjs")]
      .map((src) => src.split("claude-sonnet-4-5").length - 1)
      .reduce((a, b) => a + b, 0);
    expect(hits).toBe(1);
  });

  it("names the model, the constant and the override in the unavailable message", () => {
    const msg = modelUnavailableMessage("claude-nope-1", "exit 1: model not found");
    expect(msg).toContain('"claude-nope-1"');
    expect(msg).toContain("exit 1: model not found");
    expect(msg).toContain("DEFAULT_MODEL");
    expect(msg).toContain("--model");
  });
});
