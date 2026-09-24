import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { extractJsonObject, sandboxEnv } from "../../../scripts/skill-evals/routing/lib/driver.mjs";
import { polarityFor, summarizeEval } from "../../../scripts/skill-evals/routing/lib/summary.mjs";
import { renderInputTurns } from "../../../scripts/skill-evals/routing/lib/transcript.mjs";

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
