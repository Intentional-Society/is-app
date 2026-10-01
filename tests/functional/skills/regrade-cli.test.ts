import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { REPO_ROOT } from "../../../scripts/skill-evals/routing/lib/context.mjs";
import {
  findStaleResults,
  hashTree,
  isDirectRun,
  makeWriteGuard,
  parseArgs,
  proveClean,
  regrade,
  renderReport,
  stripCopy,
  verifyArchive,
} from "../../../scripts/skill-evals/routing/regrade.mjs";

// Unit tests for the routing re-grade CLI (#608 PR B). Every test passes a FAKE grader through
// `grader:`, so no test spawns `claude`. All output goes under the OS temp dir. The checked-in
// fixture is the archive input; it is hashed before and after, and must never change.

const FIXTURE = path.join(
  REPO_ROOT,
  "scripts",
  "skill-evals",
  "fixtures",
  "harvest-2026-09-27",
  "archive",
  "eval-commit-4-with_skill-run-1",
);

// An independent hash of a directory tree (the test does not trust the module's own hashTree).
function treeHash(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(d, ent.name), r);
      else
        out[r] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(d, ent.name)))
          .digest("hex");
    }
  };
  walk(dir, "");
  return out;
}

type Verdict = boolean | string | undefined;
type FakePass = { numTurns: number | null; verdicts: Verdict[] | null; envelopeParsed?: boolean; throws?: boolean };

// A fake runGrader: answers pass k with script[k-1], and records what it was handed.
// `onCall` runs before the answer, with the 1-based call number (used to change an archive mid-run).
function fakeGrader(script: FakePass[], onCall?: (n: number) => void) {
  const calls: { runDir: string; files: string[]; expectations: string[]; model: string; outFiles: string[] }[] = [];
  const grader = async (opts: { runDir: string; expectations: string[]; model: string }) => {
    const files = (fs.readdirSync(opts.runDir, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, "/"));
    // The copy is <out>/copies/<label>; record what else exists under <out> while the grader runs.
    const out = path.dirname(path.dirname(opts.runDir));
    const outFiles = fs.readdirSync(out).filter((f) => f !== "copies");
    calls.push({ runDir: opts.runDir, files, expectations: opts.expectations, model: opts.model, outFiles });
    onCall?.(calls.length);
    const step = script[calls.length - 1];
    if (step.throws) throw new Error("spawn claude ENOENT (fake)");
    const grading =
      step.verdicts === null
        ? null
        : {
            expectations: step.verdicts.map((v, i) =>
              v === undefined ? { text: `e${i + 1}`, evidence: "x" } : { text: `e${i + 1}`, passed: v, evidence: "x" },
            ),
          };
    const envelope = { num_turns: step.numTurns, result: grading ? JSON.stringify(grading) : "no verdict here" };
    return {
      grading,
      numTurns: step.numTurns,
      envelopeParsed: step.envelopeParsed ?? true,
      raw: JSON.stringify(envelope),
      stderr: "",
    };
  };
  return { grader, calls };
}

const allPass = (n = 3): FakePass[] =>
  Array.from({ length: n }, () => ({ numTurns: 10, verdicts: [true, true, true] }));

let tmpBase: string;
let fixtureBefore: Record<string, string>;
let failArchive: string; // a temp copy of the fixture whose archived verdict for index 2 is FAIL

beforeAll(() => {
  fixtureBefore = treeHash(FIXTURE);
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "regrade-cli-test-"));
  failArchive = path.join(tmpBase, "archive-b", "eval-commit-4-with_skill-run-2");
  fs.cpSync(FIXTURE, failArchive, { recursive: true });
  const gradingPath = path.join(failArchive, "grading.json");
  const g = JSON.parse(fs.readFileSync(gradingPath, "utf8"));
  g.expectations[1].passed = false;
  fs.writeFileSync(gradingPath, JSON.stringify(g, null, 2));
});

afterAll(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
  // Whatever happened above, the checked-in fixture is byte-identical.
  expect(treeHash(FIXTURE)).toEqual(fixtureBefore);
});

function freshOut() {
  return fs.mkdtempSync(path.join(tmpBase, "out-"));
}

async function run(script: FakePass[], extra: Record<string, unknown> = {}) {
  const fake = fakeGrader(script);
  const outRoot = freshOut();
  const result = await regrade({
    runDirs: [FIXTURE],
    queryId: "commit-4",
    passes: script.length,
    model: "fake-model",
    outRoot,
    grader: fake.grader,
    checkModel: async () => {},
    // Look for stale output only in this test's own temp folder, not the real OS temp dir.
    staleRoot: tmpBase,
    log: () => {},
    ...extra,
  });
  return { result, calls: fake.calls, outRoot };
}

describe("regrade CLI", () => {
  it("hands the grader a copy under the output root with the old verdict files stripped", async () => {
    const { result, calls, outRoot } = await run(allPass());
    expect(result.status).toBe(0);
    expect(calls).toHaveLength(3);
    const realOut = path.resolve(outRoot).toLowerCase();
    for (const c of calls) {
      for (const banned of ["grading.json", "grader-envelope.json", "timing.json"]) {
        expect(c.files.some((f) => path.posix.basename(f) === banned)).toBe(false);
      }
      expect(c.files).toContain("input.jsonl");
      expect(c.files).toContain("transcript.md");
      expect(path.resolve(c.runDir).toLowerCase().startsWith(realOut)).toBe(true);
      expect(path.resolve(c.runDir).toLowerCase().startsWith(FIXTURE.toLowerCase())).toBe(false);
      expect(c.model).toBe("fake-model");
      // Nothing is written beside the copy while any grader runs: no results/, tally or report.
      expect(c.outFiles).toEqual([]);
    }
    // The pass results are all written once the last pass is done.
    const results = path.join(outRoot, "results", result.tally.runs[0].label);
    expect(fs.existsSync(path.join(results, "pass-1.grader-envelope.json"))).toBe(true);
    expect(fs.existsSync(path.join(results, "pass-1.grading.json"))).toBe(true);
    expect(fs.existsSync(path.join(results, "pass-1.meta.json"))).toBe(true);
    // Copies are removed by default.
    expect(fs.existsSync(path.join(outRoot, "copies"))).toBe(false);
  });

  it("applies the #583 void rule per pass: a one-turn grading is void and does not vote", async () => {
    const { result } = await run([
      { numTurns: 1, verdicts: [false, false, false] },
      { numTurns: 10, verdicts: [true, true, true] },
      { numTurns: 10, verdicts: [true, true, true] },
    ]);
    const r = result.tally.runs[0];
    expect(r.passes[0].decision.voided).toBe(true);
    expect(r.voidPasses).toBe(1);
    for (const idx of r.indices) {
      expect(idx.votes[0]).toBe("VOID");
      expect(idx.failVotes).toBe(0);
      expect(idx.passVotes).toBe(2);
      expect(idx.current).toBe("PASS");
      expect(idx.flag).toBe("HOLD-PASS");
    }
    expect(result.status).toBe(0);
  });

  it("tallies three passes per expectation by majority over the non-void passes", async () => {
    const { result } = await run([
      { numTurns: 10, verdicts: [true, false, true] },
      { numTurns: 10, verdicts: [false, true, true] },
      { numTurns: 10, verdicts: [true, false, false] },
    ]);
    const [i1, i2, i3] = result.tally.runs[0].indices;
    expect([i1.passVotes, i1.failVotes, i1.current]).toEqual([2, 1, "PASS"]);
    expect([i2.passVotes, i2.failVotes, i2.current]).toEqual([1, 2, "FAIL"]);
    expect([i3.passVotes, i3.failVotes, i3.current]).toEqual([2, 1, "PASS"]);
    expect(i2.flag).toBe("PASS→FAIL");
  });

  it("counts a null grading, a string passed and a missing passed as FAIL", async () => {
    const { result } = await run([
      { numTurns: 10, verdicts: null },
      { numTurns: 10, verdicts: ["true", "true", "true"] },
      { numTurns: 10, verdicts: [undefined, undefined, undefined] },
    ]);
    for (const idx of result.tally.runs[0].indices) {
      expect(idx.votes).toEqual(["FAIL", "FAIL", "FAIL"]);
      expect(idx.current).toBe("FAIL");
    }
    expect(result.status).toBe(0);
  });

  it("reports an --unverifiable index as UNVERIFIABLE even when the grader fails it", async () => {
    const all = (v: boolean): FakePass[] => Array.from({ length: 3 }, () => ({ numTurns: 10, verdicts: [v, v, v] }));
    const { result } = await run(all(false), { unverifiable: [2] });
    const [i1, i2, i3] = result.tally.runs[0].indices;
    expect(i2.current).toBe("UNVERIFIABLE");
    expect(i2.flag).toBe("UNVERIFIABLE");
    expect(i1.flag).toBe("PASS→FAIL");
    expect(i3.flag).toBe("PASS→FAIL");
    expect(result.tally.perIndex[1].flags).toEqual({ UNVERIFIABLE: 1 });
  });

  it("refuses an output folder inside the repo and leaves the fixture byte-identical", async () => {
    const inside = path.join(REPO_ROOT, `.regrade-test-out-${process.pid}`);
    const fake = fakeGrader(allPass());
    const refused = await regrade({
      runDirs: [FIXTURE],
      queryId: "commit-4",
      outRoot: inside,
      grader: fake.grader,
      checkModel: async () => {},
      staleRoot: tmpBase,
      log: () => {},
    });
    expect(refused.status).toBe(3);
    expect(fake.calls).toHaveLength(0);
    expect(fs.existsSync(inside)).toBe(false);

    const before = treeHash(FIXTURE);
    const { result } = await run(allPass());
    expect(result.status).toBe(0);
    expect(treeHash(FIXTURE)).toEqual(before);
    expect(before).toEqual(fixtureBefore);
  });

  it("--map 2:1 moves the archived verdict of index 2 onto current index 1", async () => {
    const opts = parseArgs(["--runs", failArchive, "--query", "commit-4", "--map", "2:1"]);
    const { result } = await run(allPass(), { runDirs: opts.runDirs, map: opts.map });
    const r = result.tally.runs[0];
    expect(r.indices[0].archived).toBe("FAIL");
    expect(r.indices[0].flag).toBe("FLIP-TO-PASS");
    expect(r.indices[1].flag).toBe("NEW-PASS");
    expect(r.indices[2].flag).toBe("NEW-PASS");
    expect(r.noCurrentIndex.map((x: { archivedIndex: number }) => x.archivedIndex)).toEqual([1, 3]);

    // Without the map the same archive reads as identity: index 2 flips, index 1 holds.
    const plain = await run(allPass(), { runDirs: [failArchive] });
    expect(plain.result.tally.runs[0].indices[0].flag).toBe("HOLD-PASS");
    expect(plain.result.tally.runs[0].indices[1].flag).toBe("FLIP-TO-PASS");
  });

  it("marks a run with fewer than two non-void passes UNGRADED and returns status 1", async () => {
    const { result } = await run([
      { numTurns: 1, verdicts: [true, true, true] },
      { numTurns: 10, verdicts: [true, true, true] },
      { numTurns: null, verdicts: [true, true, true], envelopeParsed: false },
    ]);
    const r = result.tally.runs[0];
    expect(r.ungraded).toBe(true);
    expect(r.ungradedLabel).toBe("UNGRADED (2 of 3 passes void)");
    for (const idx of r.indices) expect(idx.flag).toBe("UNGRADED");
    expect(result.status).toBe(1);

    // With --passes 1 the threshold is min(2, passes) = 1: one non-void pass decides, shown as n=1.
    const one = await run([{ numTurns: 10, verdicts: [true, false, true] }]);
    const r1 = one.result.tally.runs[0];
    expect(r1.ungraded).toBe(false);
    expect(r1.indices.map((x: { flag: string }) => x.flag)).toEqual(["HOLD-PASS", "PASS→FAIL", "HOLD-PASS"]);
    expect(renderReport(one.result.tally)).toContain("non-void passes: n=1 of 1");
    expect(one.result.status).toBe(0);
  });

  it("reports a 1-1 tie after a void pass as UNGRADED (tie, votes shown) and returns status 1", async () => {
    const { result } = await run([
      { numTurns: 10, verdicts: [true, true, true] },
      { numTurns: 1, verdicts: [false, false, false] },
      { numTurns: 10, verdicts: [true, false, true] },
    ]);
    const [i1, i2, i3] = result.tally.runs[0].indices;
    expect(i1.flag).toBe("HOLD-PASS");
    expect(i2.votes).toEqual(["PASS", "VOID", "FAIL"]);
    expect(i2.flag).toBe("UNGRADED (tie, votes shown)");
    expect(i3.flag).toBe("HOLD-PASS");
    expect(result.tally.runs[0].ungraded).toBe(false);
    expect(renderReport(result.tally)).toContain("| [2] | PASS VOID FAIL |");
    expect(result.status).toBe(1);
  });

  it("writes the finished passes' results before giving up when the archive changes mid-run", async () => {
    const archive = path.join(tmpBase, "archive-c", "eval-commit-4-with_skill-run-3");
    fs.cpSync(FIXTURE, archive, { recursive: true });
    const fake = fakeGrader(allPass(), (n) => {
      if (n === 2) fs.appendFileSync(path.join(archive, "transcript.md"), "\nchanged\n");
    });
    const outRoot = freshOut();
    const result = await regrade({
      runDirs: [archive],
      queryId: "commit-4",
      outRoot,
      grader: fake.grader,
      checkModel: async () => {},
      staleRoot: tmpBase,
      log: () => {},
    });
    expect(result.status).toBe(3);
    expect(result.message).toMatch(/archive changed/);
    expect(result.message).toMatch(/transcript\.md/);
    expect(fake.calls).toHaveLength(2);
    const results = path.join(outRoot, "results", "archive-c-eval-commit-4-with_skill-run-3");
    for (const k of [1, 2]) {
      expect(fs.existsSync(path.join(results, `pass-${k}.grader-envelope.json`))).toBe(true);
      expect(fs.existsSync(path.join(results, `pass-${k}.meta.json`))).toBe(true);
    }
    expect(fs.existsSync(path.join(results, "pass-3.meta.json"))).toBe(false);
    expect(fs.existsSync(path.join(outRoot, "tally.json"))).toBe(false);
  });

  it("prints 'discrimination unproven' for an index no archived run failed", async () => {
    // Two runs x three passes: the fake answers six calls in order.
    const { result } = await run(allPass(6), { runDirs: [FIXTURE, failArchive], passes: 3 });
    expect(result.tally.runs).toHaveLength(2);
    const per = result.tally.perIndex;
    expect(per[0].discrimination).toBe("unproven");
    expect(per[1].discrimination).toBe("proven");
    expect(per[2].discrimination).toBe("unproven");
    const md = renderReport(result.tally);
    expect(md).toContain("[1] discrimination unproven");
    expect(md).not.toContain("[2] discrimination unproven");
    expect(md).toContain("[3] discrimination unproven");
  });

  it("parses arguments: --passes defaults to 3 and an unknown query names the known ids", async () => {
    const opts = parseArgs(["--runs", FIXTURE, "--query", "commit-4"]);
    expect(opts.passes).toBe(3);
    expect(opts.runDirs).toEqual([FIXTURE]);
    expect(() => parseArgs(["--query", "commit-4"])).toThrow(/--runs/);
    expect(() => parseArgs(["--runs", FIXTURE, "--query", "commit-4", "--passes", "0"])).toThrow(/--passes/);

    const fake = fakeGrader(allPass());
    const bad = await regrade({
      runDirs: [FIXTURE],
      queryId: "no-such-query",
      outRoot: freshOut(),
      grader: fake.grader,
      checkModel: async () => {},
      staleRoot: tmpBase,
      log: () => {},
    });
    expect(bad.status).toBe(2);
    expect(bad.message).toMatch(/no-such-query/);
    expect(bad.message).toMatch(/commit-4/);
    expect(bad.message).toMatch(/ship-5/);
    expect(fake.calls).toHaveLength(0);
  });
});

// A fresh copy of the fixture at <out>/copies/c, with a write guard for <out>.
function copyUnder(name: string) {
  const out = fs.mkdtempSync(path.join(tmpBase, `${name}-`));
  const copy = path.join(out, "copies", "c");
  fs.cpSync(FIXTURE, copy, { recursive: true });
  const guard = makeWriteGuard({ out, repoRoot: REPO_ROOT, runDirs: [FIXTURE] });
  return { out, copy, guard };
}

// A temp archive the test may change, never the checked-in fixture.
function tempArchive(name: string) {
  const dir = path.join(fs.mkdtempSync(path.join(tmpBase, `${name}-`)), "eval-commit-4-with_skill-run-1");
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

describe("regrade CLI: the clean-copy proof", () => {
  it("stripCopy removes the verdict files and blanks the manifest paths, and proveClean then passes", () => {
    const { out, copy, guard } = copyUnder("strip");
    const strip = stripCopy(copy, guard);
    expect(strip.removed).toEqual(expect.arrayContaining(["grading.json", "grader-envelope.json", "timing.json"]));
    expect(strip.blanked).toEqual(["destDir", "sandboxDir"]);
    const am = JSON.parse(fs.readFileSync(path.join(copy, "outputs", "archive-manifest.json"), "utf8"));
    expect([am.destDir, am.sandboxDir]).toEqual(["", ""]);
    expect(proveClean(copy, out)).toEqual({ ok: true, problems: [] });
  });

  it("proveClean fails on a copy that was never stripped", () => {
    const { out, copy } = copyUnder("unstripped");
    const proof = proveClean(copy, out);
    expect(proof.ok).toBe(false);
    expect(proof.problems.join("\n")).toMatch(/grade-derived file left in the copy: grading\.json/);
    expect(proof.problems.join("\n")).toMatch(/still has a destDir/);
  });

  it("proveClean fails when a grading.json sits in a folder above the copy", () => {
    const { out, copy, guard } = copyUnder("ancestor");
    stripCopy(copy, guard);
    fs.writeFileSync(path.join(out, "grading.json"), "{}");
    const proof = proveClean(copy, out);
    expect(proof.ok).toBe(false);
    expect(proof.problems).toEqual([`a verdict file sits above the copy: ${path.join(out, "grading.json")}`]);
  });

  it("proveClean fails when a file in the copy mentions grading.json", () => {
    const { out, copy, guard } = copyUnder("mention");
    stripCopy(copy, guard);
    fs.appendFileSync(path.join(copy, "transcript.md"), "\nsee outputs/../grading.json\n");
    const proof = proveClean(copy, out);
    expect(proof.problems).toEqual(["transcript.md names grading.json"]);
  });

  it("proveClean fails when archive-manifest.json still has a destDir after the strip", () => {
    const { out, copy, guard } = copyUnder("destdir");
    stripCopy(copy, guard);
    const amPath = path.join(copy, "outputs", "archive-manifest.json");
    const am = JSON.parse(fs.readFileSync(amPath, "utf8"));
    am.destDir = "<home>/dev/is-app/.claude/skills/routing-evals-workspace/x/run-1/outputs";
    fs.writeFileSync(amPath, JSON.stringify(am));
    const proof = proveClean(copy, out);
    expect(proof.ok).toBe(false);
    expect(proof.problems.join("\n")).toMatch(/outputs\/archive-manifest\.json still has a destDir/);
  });

  it("stripCopy needs a guard, and the guard stops it deleting from an archive", () => {
    const archive = tempArchive("guarded-strip");
    const before = treeHash(archive);
    const out = freshOut();
    expect(() => stripCopy(archive, undefined as never)).toThrow(/write guard/);
    const guard = makeWriteGuard({ out, repoRoot: REPO_ROOT, runDirs: [archive] });
    expect(() => stripCopy(archive, guard)).toThrow(/refusing to write outside the output folder/);
    expect(treeHash(archive)).toEqual(before);
  });
});

describe("regrade CLI: errors, refusals and the guards", () => {
  it("stops with status 3 before any grader call when the copy fails the clean-copy proof", async () => {
    const archive = tempArchive("dirty-run");
    fs.appendFileSync(path.join(archive, "transcript.md"), "\nthe old verdict is in grading.json\n");
    const { result, calls } = await run(allPass(), { runDirs: [archive] });
    expect(result.status).toBe(3);
    expect(result.message).toMatch(/the copy is not clean/);
    expect(result.message).toMatch(/transcript\.md names grading\.json/);
    expect(calls).toHaveLength(0);
  });

  it("an errored pass casts no vote, is counted, and makes the status 1 while the other passes decide", async () => {
    const { result } = await run([
      { numTurns: 10, verdicts: [true, true, false] },
      { numTurns: 10, verdicts: [true, true, true], throws: true },
      { numTurns: 10, verdicts: [true, true, false] },
    ]);
    const r = result.tally.runs[0];
    expect(r.erroredPasses).toBe(1);
    expect(r.passes[1].error).toMatch(/ENOENT/);
    expect(r.ungraded).toBe(false);
    expect(r.indices.map((x: { votes: string[] }) => x.votes[1])).toEqual(["ERROR", "ERROR", "ERROR"]);
    expect(r.indices.map((x: { current: string }) => x.current)).toEqual(["PASS", "PASS", "FAIL"]);
    expect(r.indices[2].failVotes).toBe(2);
    expect(result.status).toBe(1);
    // A backslash and a pipe in a table cell are escaped (backslash first), so the row stays whole.
    r.passes[1].error = "C:\\dir|x";
    expect(renderReport(result.tally)).toContain("| threw: C:\\\\dir\\|x |");
  });

  it("refuses to start while an earlier re-grade's output is in the temp dir, unless told to ignore it", async () => {
    const stale = path.join(tmpBase, "is-skill-eval-regrade-earlier");
    fs.mkdirSync(path.join(stale, "results", "some-run"), { recursive: true });
    try {
      const fake = fakeGrader(allPass());
      const refused = await regrade({
        runDirs: [FIXTURE],
        queryId: "commit-4",
        outRoot: freshOut(),
        grader: fake.grader,
        checkModel: async () => {
          throw new Error("the model check must not run before the stale check");
        },
        staleRoot: tmpBase,
        log: () => {},
      });
      expect(refused.status).toBe(3);
      expect(refused.message).toContain(stale);
      expect(refused.message).toMatch(/--ignore-stale-results/);
      expect(fake.calls).toHaveLength(0);

      const opts = parseArgs(["--runs", FIXTURE, "--query", "commit-4", "--ignore-stale-results"]);
      expect(opts.ignoreStaleResults).toBe(true);
      const { result, calls } = await run(allPass(), { ignoreStaleResults: true });
      expect(result.status).toBe(0);
      expect(calls).toHaveLength(3);
    } finally {
      fs.rmSync(stale, { recursive: true, force: true });
    }
  });

  it("findStaleResults looks three levels deep and skips the run's own output folder", () => {
    const root = fs.mkdtempSync(path.join(tmpBase, "stale-scan-"));
    const deep3 = path.join(root, "is-skill-eval-regrade-a", "x", "y");
    fs.mkdirSync(deep3, { recursive: true });
    fs.writeFileSync(path.join(deep3, "pass-1.grading.json"), "{}");
    const deep4 = path.join(root, "is-skill-eval-regrade-b", "x", "y", "z");
    fs.mkdirSync(deep4, { recursive: true });
    fs.writeFileSync(path.join(deep4, "grading.json"), "{}");
    const own = path.join(root, "is-skill-eval-regrade-own");
    fs.mkdirSync(path.join(own, "results"), { recursive: true });
    fs.mkdirSync(path.join(root, "other-folder", "results"), { recursive: true });
    const found = findStaleResults(root, own);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(path.join(root, "is-skill-eval-regrade-a"));
  });

  it("refuses an output folder that overlaps a run directory, in either direction", async () => {
    const archive = tempArchive("overlap");
    const fake = fakeGrader(allPass());
    const base = {
      runDirs: [archive],
      queryId: "commit-4",
      grader: fake.grader,
      checkModel: async () => {},
      staleRoot: tmpBase,
      log: () => {},
    };
    const inside = await regrade({ ...base, outRoot: path.join(archive, "out") });
    expect(inside.status).toBe(3);
    expect(inside.message).toMatch(/overlap/);
    const above = await regrade({ ...base, outRoot: path.dirname(archive) });
    expect(above.status).toBe(3);
    expect(above.message).toMatch(/overlap/);
    expect(fake.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(archive, "out"))).toBe(false);
  });

  it("refuses an output folder that is not empty (status 2)", async () => {
    const out = freshOut();
    fs.writeFileSync(path.join(out, "leftover.txt"), "x");
    const fake = fakeGrader(allPass());
    const { result } = await run(allPass(), { outRoot: out, grader: fake.grader });
    expect(result.status).toBe(2);
    expect(result.message).toMatch(/not empty/);
    expect(fake.calls).toHaveLength(0);
  });

  it("verifyArchive throws naming the file when an archive changed", () => {
    const archive = tempArchive("verify");
    const hashes = hashTree(archive);
    expect(() => verifyArchive(archive, hashes, "after a pass")).not.toThrow();
    fs.appendFileSync(path.join(archive, "outputs", "observables.json"), " ");
    expect(() => verifyArchive(archive, hashes, "after a pass")).toThrow(/changed: outputs\/observables\.json/);
  });

  it("the write guard refuses the repo, a run dir and anything outside the output folder", () => {
    const archive = tempArchive("guard");
    const out = freshOut();
    const guard = makeWriteGuard({ out, repoRoot: REPO_ROOT, runDirs: [archive] });
    expect(() => guard(path.join(REPO_ROOT, "x.json"))).toThrow(/refusing to write/);
    expect(() => guard(path.join(archive, "grading.json"))).toThrow(/refusing to write/);
    expect(() => guard(path.join(tmpBase, "elsewhere.json"))).toThrow(/refusing to write/);
    const ok = path.join(out, "results", "r", "pass-1.meta.json");
    expect(guard(ok)).toBe(ok);
    // An output folder placed inside the repo is still refused by the guard on its own.
    const inRepo = makeWriteGuard({ out: REPO_ROOT, repoRoot: REPO_ROOT, runDirs: [] });
    expect(() => inRepo(path.join(REPO_ROOT, "tally.json"))).toThrow(/refusing to write/);
  });
});

describe("regrade CLI: the default output folder", () => {
  const ownDirs = () => new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("is-skill-eval-regrade-")));

  it("is made by mkdtemp under the OS temp dir, and removed again if the run stops before grading", async () => {
    const before = ownDirs();
    const { result } = await run(allPass(), { outRoot: undefined });
    try {
      expect(result.status).toBe(0);
      const out = result.outRoot as string;
      expect(path.dirname(out).toLowerCase()).toBe(path.resolve(os.tmpdir()).toLowerCase());
      expect(path.basename(out)).toMatch(/^is-skill-eval-regrade-[A-Za-z0-9]{6}$/);
      expect(fs.existsSync(path.join(out, "tally.json"))).toBe(true);
    } finally {
      if (result.outRoot) fs.rmSync(result.outRoot, { recursive: true, force: true });
    }

    const stale = path.join(tmpBase, "is-skill-eval-regrade-earlier-2");
    fs.mkdirSync(path.join(stale, "results"), { recursive: true });
    try {
      const refused = await run(allPass(), { outRoot: undefined });
      expect(refused.result.status).toBe(3);
      expect(refused.calls).toHaveLength(0);
    } finally {
      fs.rmSync(stale, { recursive: true, force: true });
    }
    expect(ownDirs()).toEqual(before);
  });
});

describe("regrade CLI: directory junctions (Windows)", () => {
  // A junction needs no admin rights on Windows. Every junction here points at a temp folder,
  // never into the repo, and is removed with unlinkSync (which removes the link, not the target).
  function junction(target: string, link: string) {
    fs.symlinkSync(target, link, "junction");
    return link;
  }

  it("runs the CLI when its path goes through a junction (the direct-run check resolves both sides)", () => {
    const realDir = fs.mkdtempSync(path.join(tmpBase, "real-"));
    const realFile = path.join(realDir, "regrade.mjs");
    fs.writeFileSync(realFile, "// stand-in\n");
    const link = junction(realDir, path.join(tmpBase, `link-${process.pid}`));
    try {
      const url = pathToFileURL(realFile).href;
      expect(isDirectRun(path.join(link, "regrade.mjs"), url)).toBe(true);
      expect(isDirectRun(realFile, url)).toBe(true);
      expect(isDirectRun(path.join(realDir, "other.mjs"), url)).toBe(false);
      expect(isDirectRun(undefined as never, url)).toBe(false);
    } finally {
      fs.unlinkSync(link);
    }
  });

  it("re-grades a --runs path given through a junction", async () => {
    const archive = tempArchive("junction-run");
    const before = treeHash(archive);
    const link = junction(path.dirname(archive), path.join(tmpBase, `runs-link-${process.pid}`));
    try {
      const { result, calls } = await run(allPass(), { runDirs: [path.join(link, path.basename(archive))] });
      expect(result.status).toBe(0);
      expect(calls).toHaveLength(3);
      expect(result.tally.runs[0].indices.map((x: { flag: string }) => x.flag)).toEqual([
        "HOLD-PASS",
        "HOLD-PASS",
        "HOLD-PASS",
      ]);
      expect(treeHash(archive)).toEqual(before);
    } finally {
      fs.unlinkSync(link);
    }
  });
});
