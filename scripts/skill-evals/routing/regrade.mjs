#!/usr/bin/env node
// Routing re-grade CLI (#608 PR B): re-grade archived ROUTING runs with the unchanged stock
// grader (`runGrader` in lib/driver.mjs), so a reworded assertion can be checked against
// known-PASS and known-FAIL archives before a paid batch is spent
// (docs/strategy-skill-evals.md §6 step 5).
//
// Usage:
//   node scripts/skill-evals/routing/regrade.mjs --runs <runDir> [<runDir>...] --query <queryId>
//        [--passes 3] [--model <id>] [--map old:new,...] [--unverifiable i,j] [--out <dir>]
//        [--keep-copies] [--ignore-stale-results]
//
// What it does, per run directory:
//   1. reads the archived grading.json (the old verdict) BEFORE anything is copied;
//   2. copies the run to <out>/copies/<label>/, deletes every grade-derived file from the copy,
//      blanks the two paths in outputs/archive-manifest.json, and proves the copy is clean;
//   3. grades the copy N times, serially, with the stock runGrader, applying the #583 void rule
//      (graderPersistenceDecision) to each pass;
//   4. tallies each CURRENT expectation by majority over the non-void passes and flags it
//      against the archived verdict.
// The archived run directories are read-only: every file is hashed before the first pass and
// re-checked after every pass. Nothing is ever written inside the repo.
//
// Exit codes: 0 the re-grade completed (flags are information); 1 a run or an index is UNGRADED
// (too few non-void passes, or a tie) or a pass threw; 2 usage or precondition; 3 safety (output
// inside the repo, archive changed, copy not clean, an earlier re-grade's output still in the OS temp
// dir). Pass results are written only after the last
// pass, because the grader works from a sibling folder in the OS temp dir.
//
// Adapted from the maintainer's laptop script for PR 3 (.scratch/hub3/regrade-evidence/), which
// is credited for the write guard, the hash and re-verify discipline, the ancestor walk and the
// serial passes. Importing this file has no side effects; main() runs only when executed.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT } from "./lib/context.mjs";
import { checkModelAvailable, DEFAULT_MODEL, runGrader } from "./lib/driver.mjs";
import { graderPersistenceDecision } from "./lib/grading.mjs";
import { ROUTING_QUERIES } from "./routing-plan.mjs";

export const DEFAULT_PASSES = 3;

export const EXIT = { OK: 0, INCOMPLETE: 1, USAGE: 2, SAFETY: 3 };

/** A usage or precondition problem (exit 2). */
export class UsageError extends Error {}

/** A safety refusal (exit 3). */
export class SafetyError extends Error {}

// ---------------------------------------------------------------------------------------------
// The strip list: files that carry, or are only written alongside, a verdict
// ---------------------------------------------------------------------------------------------

export const STRIP_BASENAMES = new Set([
  "grading.json",
  "grader-envelope.json",
  "timing.json",
  "grader-raw.txt",
  "runner-error.txt",
  // Aggregates that live above a run dir; never expected inside one, removed if they are.
  "benchmark.json",
  "benchmark.md",
  "routing_summary.json",
  "eval_metadata.json",
]);

const STRIP_PATTERNS = [/^regrade/i, /^grading[^\\/]*\.json$/i, /^grader-raw/i, /^grader-envelope/i];

/** True when a file with this basename is grade-derived and must not reach the grader. */
export function isStripped(basename) {
  return STRIP_BASENAMES.has(basename) || STRIP_PATTERNS.some((re) => re.test(basename));
}

/** The words a clean copy must not contain anywhere (case-insensitive). */
const CLEAN_NEEDLES = ["grading.json", "grader-envelope.json"];

const ARCHIVE_MANIFEST_REL = "outputs/archive-manifest.json";

// ---------------------------------------------------------------------------------------------
// Paths and hashing
// ---------------------------------------------------------------------------------------------

/**
 * Resolve through symlinks, junctions and 8.3 short names where the path exists; for a path not
 * created yet, realpath its nearest existing ancestor and append the rest.
 */
export function realResolve(p) {
  const abs = path.resolve(p);
  const tail = [];
  let cur = abs;
  for (;;) {
    try {
      const real = fs.realpathSync.native(cur);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * True when `child` is `parent` or lies beneath it, after resolving both sides. The same test as
 * driver.mjs's internal `isInside`, re-implemented here because that one is not exported.
 */
export function isInsidePath(child, parent) {
  const rel = path.relative(realResolve(parent), realResolve(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Every file under `dir`, as forward-slash relative paths, sorted. */
export function walkFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(d, ent.name), r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out.sort();
}

/** `{relPath: {size, sha256}}` for every file under `dir`. */
export function hashTree(dir) {
  const out = {};
  for (const rel of walkFiles(dir)) {
    const buf = fs.readFileSync(path.join(dir, rel));
    out[rel] = { size: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") };
  }
  return out;
}

/** The differences between two hashTree results, one line per file. */
export function diffHashes(before, after) {
  const changes = [];
  for (const rel of Object.keys(before)) {
    if (!(rel in after)) changes.push(`removed: ${rel}`);
    else if (before[rel].sha256 !== after[rel].sha256 || before[rel].size !== after[rel].size) {
      changes.push(`changed: ${rel}`);
    }
  }
  for (const rel of Object.keys(after)) if (!(rel in before)) changes.push(`added: ${rel}`);
  return changes;
}

/** A folder name for one run: `<eval dir>-<run dir>`, with the config folder kept when present. */
export function runLabel(runDir) {
  const abs = path.resolve(runDir);
  const run = path.basename(abs);
  const parent = path.basename(path.dirname(abs));
  const parts = /^with(out)?[_-]skill$/i.test(parent)
    ? [path.basename(path.dirname(path.dirname(abs))), parent, run]
    : [parent, run];
  return parts.join("-").replace(/[^\w.-]/g, "_");
}

// ---------------------------------------------------------------------------------------------
// Copy hygiene: strip, then prove
// ---------------------------------------------------------------------------------------------

/**
 * The write guard: returns a function that passes a target through only when it lies under
 * `out` and outside the repo and every run dir, and otherwise throws a SafetyError.
 * @param {{out: string, repoRoot: string, runDirs: string[]}} roots
 */
export function makeWriteGuard({ out, repoRoot, runDirs }) {
  return (target) => {
    const ok =
      isInsidePath(target, out) && !isInsidePath(target, repoRoot) && !runDirs.some((d) => isInsidePath(target, d));
    if (!ok) throw new SafetyError(`refusing to write outside the output folder: ${target}`);
    return target;
  };
}

/**
 * Delete every grade-derived file from a COPY and blank `destDir` / `sandboxDir` in its
 * outputs/archive-manifest.json. Every delete and write goes through `guard` (from
 * makeWriteGuard), so this can never touch an archive.
 * @returns {{removed: string[], blanked: string[]}}
 */
export function stripCopy(copyDir, guard) {
  if (typeof guard !== "function") throw new TypeError("stripCopy needs a write guard");
  const removed = [];
  for (const rel of walkFiles(copyDir)) {
    if (isStripped(path.posix.basename(rel))) {
      fs.rmSync(guard(path.join(copyDir, rel)), { force: true });
      removed.push(rel);
    }
  }
  const blanked = [];
  const amPath = path.join(copyDir, ARCHIVE_MANIFEST_REL);
  if (fs.existsSync(amPath)) {
    const am = JSON.parse(fs.readFileSync(amPath, "utf8"));
    for (const key of ["destDir", "sandboxDir"]) {
      if (key in am) {
        am[key] = "";
        blanked.push(key);
      }
    }
    fs.writeFileSync(guard(amPath), `${JSON.stringify(am, null, 2)}\n`);
  }
  return { removed, blanked };
}

function stringLeaves(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) stringLeaves(v, out);
  return out;
}

/** Each existing `name` that sits directly in `start` or any folder above it. */
function ancestorHits(start, names) {
  const hits = [];
  let cur = path.resolve(start);
  for (;;) {
    for (const n of names) if (fs.existsSync(path.join(cur, n))) hits.push(path.join(cur, n));
    const parent = path.dirname(cur);
    if (parent === cur) return hits;
    cur = parent;
  }
}

/**
 * Prove a stripped copy cannot show the grader an old verdict:
 *  - no grade-derived file is left in it;
 *  - no file names `grading.json` or `grader-envelope.json` (archive-manifest.json is checked
 *    by its values only, so its own key names cannot trip it);
 *  - `destDir` and `sandboxDir` in outputs/archive-manifest.json are blank (they point back at
 *    the archive and the old sandbox);
 *  - no folder above the copy, or above the OS temp dir where runGrader makes its own copy,
 *    holds a `grading.json` or `grader-envelope.json`.
 * @returns {{ok: boolean, problems: string[]}}
 */
export function proveClean(copyDir, outRoot) {
  const problems = [];
  if (!isInsidePath(copyDir, outRoot)) problems.push(`the copy is not under the output root: ${copyDir}`);
  for (const rel of walkFiles(copyDir)) {
    if (isStripped(path.posix.basename(rel))) problems.push(`grade-derived file left in the copy: ${rel}`);
    const text = fs.readFileSync(path.join(copyDir, rel), "utf8");
    let haystacks = [text];
    if (rel === ARCHIVE_MANIFEST_REL) {
      try {
        const am = JSON.parse(text);
        haystacks = stringLeaves(am);
        for (const key of ["destDir", "sandboxDir"]) {
          if (am?.[key]) problems.push(`${rel} still has a ${key}: ${am[key]}`);
        }
      } catch {
        // not JSON: check the whole text
      }
    }
    for (const needle of CLEAN_NEEDLES) {
      if (haystacks.some((h) => h.toLowerCase().includes(needle))) problems.push(`${rel} names ${needle}`);
    }
  }
  const seen = new Set();
  for (const start of [path.dirname(path.resolve(copyDir)), os.tmpdir()]) {
    for (const hit of ancestorHits(start, CLEAN_NEEDLES)) {
      if (!seen.has(hit)) problems.push(`a verdict file sits above the copy: ${hit}`);
      seen.add(hit);
    }
  }
  return { ok: problems.length === 0, problems };
}

export const OUT_PREFIX = "is-skill-eval-regrade-";

/**
 * Earlier re-grade output still in the temp dir. `runGrader` grades from a folder directly in
 * `os.tmpdir()`, so a grader's `ls ..` reaches every sibling: an earlier run's `results/` or
 * verdict files there could be read. Looks in each `is-skill-eval-regrade-*` child of `tmpRoot`
 * (other than `ownOut`) at most three levels deep for a `results` folder or a file whose name
 * ends in `grading.json` / `grader-envelope.json`.
 * @returns {string[]} the stale folders, one entry each, naming what was found.
 */
export function findStaleResults(tmpRoot, ownOut) {
  const stale = [];
  let children = [];
  try {
    children = fs.readdirSync(tmpRoot, { withFileTypes: true });
  } catch {
    return stale;
  }
  for (const ent of children) {
    if (!ent.isDirectory() || !ent.name.startsWith(OUT_PREFIX)) continue;
    const dir = path.join(tmpRoot, ent.name);
    if (ownOut && isInsidePath(dir, ownOut) && isInsidePath(ownOut, dir)) continue;
    const hit = staleHit(dir, 1);
    if (hit) stale.push(`${dir} (${hit})`);
  }
  return stale;
}

function staleHit(dir, depth) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isDirectory() && e.name === "results") return `holds ${path.join(dir, e.name)}`;
    if (!e.isDirectory() && CLEAN_NEEDLES.some((n) => e.name.toLowerCase().endsWith(n))) {
      return `holds ${path.join(dir, e.name)}`;
    }
  }
  if (depth >= 3) return null;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hit = staleHit(path.join(dir, e.name), depth + 1);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Arguments and the query's text
// ---------------------------------------------------------------------------------------------

function positiveInt(s, what) {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`${what}: "${s}" is not a whole number of 1 or more`);
  return n;
}

/** `"2:1,3:2"` -> `[[2, 1], [3, 2]]` (1-based, archived index first). */
export function parseIndexMap(text) {
  const pairs = [];
  for (const part of String(text).split(",").filter(Boolean)) {
    const m = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(part);
    if (!m) throw new UsageError(`--map: "${part}" is not old:new`);
    const pair = [positiveInt(m[1], "--map"), positiveInt(m[2], "--map")];
    if (pairs.some(([old]) => old === pair[0])) throw new UsageError(`--map: archived index ${pair[0]} mapped twice`);
    pairs.push(pair);
  }
  if (!pairs.length) throw new UsageError("--map needs at least one old:new pair");
  return pairs;
}

/** `"1,3"` -> `[1, 3]` (1-based). */
export function parseIndexList(text) {
  const list = String(text)
    .split(",")
    .filter((s) => s.trim())
    .map((s) => positiveInt(s.trim(), "--unverifiable"));
  return [...new Set(list)].sort((a, b) => a - b);
}

/** Parse the command line. Throws UsageError; never exits. */
export function parseArgs(argv) {
  const o = {
    runDirs: [],
    queryId: null,
    passes: DEFAULT_PASSES,
    model: DEFAULT_MODEL,
    map: null,
    unverifiable: [],
    outRoot: null,
    keepCopies: false,
    ignoreStaleResults: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value`);
      i++;
      return v;
    };
    if (a === "--runs") {
      while (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) o.runDirs.push(argv[++i]);
      if (!o.runDirs.length) throw new UsageError("--runs needs at least one run directory");
    } else if (a === "--query") o.queryId = value();
    else if (a === "--passes") o.passes = positiveInt(value(), "--passes");
    else if (a === "--model") o.model = value();
    else if (a === "--map") o.map = parseIndexMap(value());
    else if (a === "--unverifiable") o.unverifiable = parseIndexList(value());
    else if (a === "--out") o.outRoot = value();
    else if (a === "--keep-copies") o.keepCopies = true;
    else if (a === "--ignore-stale-results") o.ignoreStaleResults = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new UsageError(`unknown argument: ${a}`);
  }
  if (!o.help) {
    if (!o.runDirs.length) throw new UsageError("--runs is required");
    if (!o.queryId) throw new UsageError("--query is required");
  }
  return o;
}

/**
 * The query's expectations and grader hint, read from the WORKING TREE the way the runner reads
 * them. This re-implements the runner's `loadExpectations` (run-routing-evals.mjs), because that
 * script starts a batch on import and so cannot be imported.
 */
export function resolveQuery(queryId, repoRoot = REPO_ROOT) {
  const q = ROUTING_QUERIES.find((x) => x.queryId === queryId);
  if (!q) {
    const ids = ROUTING_QUERIES.map((x) => x.queryId).join(", ");
    throw new UsageError(`unknown query "${queryId}". Known query ids: ${ids}`);
  }
  let expectations = q.expectationsOverride;
  let source = "routing-plan.mjs expectationsOverride";
  if (!expectations) {
    const file = path.join(repoRoot, ".claude", "skills", q.skill, "evals", "evals.json");
    const found = JSON.parse(fs.readFileSync(file, "utf8")).evals.find((e) => e.id === q.evalId);
    if (!found?.expectations?.length) throw new UsageError(`${q.evalId}: no expectations in ${file}`);
    expectations = found.expectations;
    source = `.claude/skills/${q.skill}/evals/evals.json`;
  }
  return { queryId, evalId: q.evalId, skill: q.skill, source, expectations, graderHint: q.graderHint ?? "" };
}

// ---------------------------------------------------------------------------------------------
// Tally and flags (pure)
// ---------------------------------------------------------------------------------------------

/** One pass's vote on one expectation (0-based). Only `passed === true` is a PASS. */
function voteOf(pass, i) {
  if (pass.error) return "ERROR";
  if (pass.decision?.voided) return "VOID";
  return pass.grading?.expectations?.[i]?.passed === true ? "PASS" : "FAIL";
}

/**
 * Tally one run's passes per CURRENT expectation.
 * @param {{passRecords: {decision?: {voided: boolean}, grading?: any, error?: string}[],
 *   expectationCount: number, unverifiable?: number[]}} input  (unverifiable is 1-based)
 */
export function tallyPasses({ passRecords, expectationCount, unverifiable = [] }) {
  const total = passRecords.length;
  const errorCount = passRecords.filter((p) => p.error).length;
  const voidCount = passRecords.filter((p) => !p.error && p.decision?.voided).length;
  const voting = total - errorCount - voidCount;
  // Two non-void passes are needed, or every pass when fewer than two were asked for (--passes 1).
  const needed = Math.min(2, total);
  const ungraded = voting < needed;
  let ungradedLabel = null;
  if (ungraded) {
    const errored = errorCount ? `, ${errorCount} errored` : "";
    ungradedLabel = `UNGRADED (${voidCount} of ${total} passes void${errored})`;
  }
  const indices = [];
  for (let i = 0; i < expectationCount; i++) {
    const votes = passRecords.map((p) => voteOf(p, i));
    const passVotes = votes.filter((v) => v === "PASS").length;
    const failVotes = votes.filter((v) => v === "FAIL").length;
    let current;
    if (unverifiable.includes(i + 1)) current = "UNVERIFIABLE";
    else if (ungraded) current = "UNGRADED";
    // A split vote is evidence of neither a pass nor a failure, so a tie is not graded.
    else if (passVotes === failVotes) current = "TIE";
    else current = passVotes > failVotes ? "PASS" : "FAIL";
    indices.push({ index: i + 1, votes, passVotes, failVotes, current, split: passVotes > 0 && failVotes > 0 });
  }
  const ties = indices.filter((x) => x.current === "TIE").length;
  return { total, needed, voting, voidCount, errorCount, ungraded, ungradedLabel, ties, indices };
}

export const TIE_FLAG = "UNGRADED (tie, votes shown)";

/**
 * The flag for one index: archived verdict ("PASS" | "FAIL" | null) against the current one
 * ("PASS" | "FAIL" | "TIE" | "UNGRADED" | "UNVERIFIABLE").
 */
export function flagFor(archived, current) {
  if (current === "TIE") return TIE_FLAG;
  if (current === "UNVERIFIABLE" || current === "UNGRADED") return current;
  if (archived == null) return current === "PASS" ? "NEW-PASS" : "NEW-FAIL";
  if (archived === "PASS") return current === "PASS" ? "HOLD-PASS" : "PASS→FAIL";
  return current === "PASS" ? "FLIP-TO-PASS" : "STILL-FAIL";
}

/** Archived verdicts by 0-based index ("PASS" | "FAIL"), or null when there is no usable record. */
export function archivedVerdicts(grading) {
  if (!Array.isArray(grading?.expectations)) return null;
  return grading.expectations.map((e) => (e?.passed === true ? "PASS" : "FAIL"));
}

/**
 * Carry archived verdicts onto CURRENT indices through the 1-based map (identity by default).
 * Two archived indices merged onto one current index give FAIL if either was FAIL.
 */
export function mapArchived({ archived, map, currentCount }) {
  const byCurrent = Array.from({ length: currentCount }, () => ({ verdict: null, from: [] }));
  const noCurrentIndex = [];
  if (!archived) return { byCurrent, noCurrentIndex };
  const pairs = map ?? archived.map((_, i) => [i + 1, i + 1]);
  archived.forEach((verdict, i) => {
    const pair = pairs.find(([old]) => old === i + 1);
    if (!pair || pair[1] > currentCount) {
      noCurrentIndex.push({ archivedIndex: i + 1, verdict });
      return;
    }
    const slot = byCurrent[pair[1] - 1];
    slot.from.push(i + 1);
    slot.verdict = slot.verdict === "FAIL" || verdict === "FAIL" ? "FAIL" : "PASS";
  });
  return { byCurrent, noCurrentIndex };
}

/** Per CURRENT index across all runs: flag counts and whether any archived run failed it. */
export function summarizeIndices(runs, expectations) {
  return expectations.map((text, i) => {
    const flags = {};
    let archivedFailSeen = false;
    for (const r of runs) {
      const idx = r.indices[i];
      flags[idx.flag] = (flags[idx.flag] ?? 0) + 1;
      if (idx.archived === "FAIL") archivedFailSeen = true;
    }
    return { index: i + 1, text, flags, discrimination: archivedFailSeen ? "proven" : "unproven" };
  });
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

// Escape backslashes first, then pipes, so a value cannot break out of a table cell.
const cell = (s) => String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s+/g, " ");
const flagText = (flags) =>
  Object.entries(flags)
    .map(([f, n]) => `${f} x${n}`)
    .join(", ");

/** The per-index lines printed to stdout and placed in report.md. */
export function summaryLines(tally) {
  const lines = tally.perIndex.map((p) => `[${p.index}] ${flagText(p.flags)}`);
  for (const p of tally.perIndex) {
    if (p.discrimination === "unproven") lines.push(`[${p.index}] discrimination unproven (no archived run failed it)`);
  }
  return lines;
}

/** report.md from a tally. */
export function renderReport(tally) {
  const q = tally.query;
  const md = [
    `# Routing re-grade: ${q.queryId}`,
    "",
    `- generated: ${tally.generatedAt}`,
    `- query: \`${q.queryId}\` (eval \`${q.evalId}\`, skill /${q.skill}); expectations from ${q.source}`,
    `- model: \`${tally.model}\` · passes per run: ${tally.passes} · runs: ${tally.runs.length}`,
    `- void passes: ${tally.voidPasses} · errored passes: ${tally.erroredPasses}`,
    `- index map (archived:current): ${tally.map ? tally.map.map(([a, b]) => `${a}:${b}`).join(", ") : "identity"}`,
    `- unverifiable in re-grade: ${tally.unverifiable.length ? tally.unverifiable.join(", ") : "none"}`,
    `- output: \`${tally.outRoot}\``,
    "",
    "A void pass (#583: the grader made one turn or fewer, or its turn count is unknown) casts no vote.",
    "A null or unparseable grade, or any `passed` other than `true`, is a FAIL vote. A run's verdict for",
    "an index is the majority of its non-void passes (n below). A tie is reported UNGRADED with its votes shown.",
    "A run needs two non-void passes (one when --passes 1); with fewer it is UNGRADED.",
    "",
    "## Current expectations",
    "",
    ...q.expectations.map((e, i) => `${i + 1}. ${e}`),
    "",
    "## Per-index summary",
    "",
    ...summaryLines(tally).map((l) => `- ${l}`),
  ];
  for (const r of tally.runs) {
    md.push("", `## Run \`${r.label}\``, "", `- run dir: \`${r.runDir}\``);
    md.push(
      r.archivedPresent
        ? `- archived summary: \`${JSON.stringify(r.archivedSummary ?? null)}\``
        : "- no usable archived grading.json: flags are NEW-PASS / NEW-FAIL",
    );
    md.push(`- non-void passes: n=${r.nonVoidPasses} of ${r.passes.length}`);
    if (r.ungradedLabel) md.push(`- **${r.ungradedLabel}**`);
    md.push("", "| idx | votes (pass 1..N) | re-grade | archived | flag |", "|---|---|---|---|---|");
    for (const idx of r.indices) {
      const archived = idx.archived ? `${idx.archived} (from [${idx.archivedFrom.join(", ")}])` : "none";
      md.push(`| [${idx.index}] | ${idx.votes.join(" ")} | ${idx.current} | ${archived} | ${cell(idx.flag)} |`);
    }
    for (const n of r.noCurrentIndex) md.push(`- archived [${n.archivedIndex}] (${n.verdict}): no current index`);
    md.push("", "| pass | num_turns | void | decision |", "|---|---|---|---|");
    for (const p of r.passes) {
      const why = p.error ? `threw: ${p.error}` : (p.decision?.error ?? "counted");
      md.push(`| ${p.pass} | ${p.numTurns ?? "?"} | ${p.decision?.voided ? "yes" : "no"} | ${cell(why)} |`);
    }
  }
  return `${md.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------

/** Re-hash one archive and throw a SafetyError naming every file that differs from `hashes`. */
export function verifyArchive(runDir, hashes, when = "") {
  const changes = diffHashes(hashes, hashTree(runDir));
  if (changes.length) {
    throw new SafetyError(`the archive changed ${when}: ${runDir}\n  ${changes.join("\n  ")}`);
  }
}

function verifyArchives(baselines, when) {
  for (const b of baselines) verifyArchive(b.runDir, b.hashes, when);
}

/**
 * @typedef {object} RegradeOptions
 * @property {string[]} runDirs
 * @property {string} queryId
 * @property {number} [passes]
 * @property {string} [model]
 * @property {Array<[number, number]> | null} [map]
 * @property {number[]} [unverifiable]
 * @property {string | null} [outRoot]
 * @property {boolean} [keepCopies]
 * @property {boolean} [ignoreStaleResults]
 * @property {(opts: any) => Promise<any>} [grader]  runGrader, or a fake in tests
 * @property {(model: string) => Promise<void>} [checkModel]
 * @property {string} [repoRoot]
 * @property {(...args: any[]) => void} [log]
 * @property {string} [staleRoot]
 */

/** @typedef {{status: number, message: string, outRoot?: string, tally?: any}} RegradeResult */

/**
 * Re-grade archived routing runs. Takes the grader and the model check as injected dependencies
 * so tests never spawn `claude`. Never exits; returns `{status, message, outRoot, tally}`
 * (`outRoot` and `tally` are absent when it stopped before grading).
 * @param {RegradeOptions} options
 * @returns {Promise<RegradeResult>}
 */
export async function regrade({
  runDirs,
  queryId,
  passes = DEFAULT_PASSES,
  model = DEFAULT_MODEL,
  map = null,
  unverifiable = [],
  outRoot = null,
  keepCopies = false,
  ignoreStaleResults = false,
  grader = runGrader,
  checkModel = checkModelAvailable,
  repoRoot = REPO_ROOT,
  log = console.log,
  // Test seam: where to look for an earlier re-grade's output. runGrader always grades from
  // os.tmpdir(), so a real run should never change it.
  staleRoot = os.tmpdir(),
}) {
  let copiesRoot = null;
  let guard = null;
  // Pass results are held in memory and written only after the last pass of the last run:
  // runGrader grades from a sibling folder in the OS temp dir, so a result written mid-run could
  // be read by the grader of a later pass. `flush` writes whatever is held.
  let flush = null;
  let passesDone = 0;
  let createdOut = null;
  try {
    return await regradeSteps();
  } catch (e) {
    // A default output root made by mkdtemp but never used: remove it (rmdirSync only removes an
    // empty folder).
    if (createdOut && passesDone === 0) {
      try {
        fs.rmdirSync(createdOut);
      } catch {
        // not empty, or already gone: leave it
      }
    }
    // About to give up after at least one pass: no grader is running now, so keep what exists.
    if (flush && passesDone > 0) {
      try {
        flush();
      } catch (flushError) {
        log(`could not write the partial results: ${flushError?.message ?? flushError}`);
      }
    }
    if (e instanceof UsageError) return { status: EXIT.USAGE, message: e.message };
    if (e instanceof SafetyError) return { status: EXIT.SAFETY, message: `SAFETY: ${e.message}` };
    throw e;
  } finally {
    if (copiesRoot && guard && !keepCopies) fs.rmSync(guard(copiesRoot), { recursive: true, force: true });
  }

  async function regradeSteps() {
    const query = resolveQuery(queryId, repoRoot);
    const count = query.expectations.length;
    for (const i of unverifiable) {
      if (i > count) throw new UsageError(`--unverifiable ${i}: query ${queryId} has ${count} expectations`);
    }
    for (const [, now] of map ?? []) {
      if (now > count) throw new UsageError(`--map: current index ${now} is past the ${count} expectations`);
    }
    if (!runDirs?.length) throw new UsageError("no run directories given");
    const dirs = runDirs.map((d) => path.resolve(d));
    for (const d of dirs) {
      if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) throw new UsageError(`run directory not found: ${d}`);
    }
    if (new Set(dirs.map((d) => realResolve(d).toLowerCase())).size !== dirs.length) {
      throw new UsageError("the same run directory is named twice");
    }

    // The default output root gets an unpredictable name from mkdtemp (created empty, so the
    // "must be empty" check below passes); an explicit --out is checked as given.
    if (!outRoot) createdOut = fs.mkdtempSync(path.join(os.tmpdir(), OUT_PREFIX));
    const out = path.resolve(outRoot || createdOut);
    if (isInsidePath(out, repoRoot)) throw new SafetyError(`the output folder is inside the repo: ${out}`);
    for (const d of dirs) {
      if (isInsidePath(out, d) || isInsidePath(d, out)) {
        throw new SafetyError(`the output folder and a run directory overlap: ${out} / ${d}`);
      }
    }
    if (fs.existsSync(out) && fs.readdirSync(out).length)
      throw new UsageError(`the output folder is not empty: ${out}`);

    // Pre-flight: an earlier re-grade's output beside runGrader's working folder could be read.
    const stale = findStaleResults(staleRoot, out);
    if (stale.length) {
      const list = stale.join("\n  ");
      if (!ignoreStaleResults) {
        throw new SafetyError(
          `earlier re-grade output is still in the temp dir, where the grader could read it:\n  ${list}\n` +
            "Move or delete it, or pass --ignore-stale-results.",
        );
      }
      log(`--ignore-stale-results: going ahead although earlier output is in the temp dir:\n  ${list}`);
    }

    // Write guard: every write lands under `out`, never in the repo or in an archive.
    guard = makeWriteGuard({ out, repoRoot, runDirs: dirs });
    const write = (target, data) => {
      fs.mkdirSync(path.dirname(guard(target)), { recursive: true });
      fs.writeFileSync(target, data);
    };
    const writeJson = (target, obj) => write(target, `${JSON.stringify(obj, null, 2)}\n`);
    const pending = [];
    const hold = (target, data) => pending.push({ target: guard(target), data });
    const holdJson = (target, obj) => hold(target, `${JSON.stringify(obj, null, 2)}\n`);
    flush = () => {
      while (pending.length) {
        const { target, data } = pending.shift();
        write(target, data);
      }
    };

    const baselines = dirs.map((runDir) => ({ runDir, hashes: hashTree(runDir) }));

    try {
      await checkModel(model);
    } catch (e) {
      throw new UsageError(e?.message ?? String(e));
    }

    fs.mkdirSync(guard(out), { recursive: true });
    copiesRoot = path.join(out, "copies");
    const used = new Set();
    const runs = [];

    for (const runDir of dirs) {
      let label = runLabel(runDir);
      for (let n = 2; used.has(label); n++) label = `${runLabel(runDir)}-${n}`;
      used.add(label);

      // 1. The archived verdict, read before anything is copied.
      const gradingPath = path.join(runDir, "grading.json");
      let archivedGrading = null;
      if (fs.existsSync(gradingPath)) {
        try {
          archivedGrading = JSON.parse(fs.readFileSync(gradingPath, "utf8"));
        } catch {
          archivedGrading = { unreadable: true };
        }
      }

      // 2. Copy, strip, prove.
      const copyDir = guard(path.join(copiesRoot, label));
      fs.mkdirSync(guard(path.dirname(copyDir)), { recursive: true });
      fs.cpSync(runDir, copyDir, { recursive: true, errorOnExist: true, force: false });
      const strip = stripCopy(copyDir, guard);
      const proof = proveClean(copyDir, out);
      if (!proof.ok) throw new SafetyError(`the copy is not clean: ${copyDir}\n  ${proof.problems.join("\n  ")}`);
      verifyArchives(baselines, `while copying ${label}`);

      // 3. Serial passes with the stock grader.
      const resultsDir = path.join(out, "results", label);
      const passRecords = [];
      for (let k = 1; k <= passes; k++) {
        const base = path.join(resultsDir, `pass-${k}`);
        let rec;
        try {
          const res = await grader({
            runDir: copyDir,
            repoRoot,
            expectations: query.expectations,
            graderHint: query.graderHint,
            model,
          });
          const decision = graderPersistenceDecision({
            grading: res.grading,
            numTurns: res.numTurns,
            envelopeParsed: res.envelopeParsed,
          });
          hold(`${base}.grader-envelope.json`, res.raw ?? "");
          if (res.grading) holdJson(`${base}.grading.json`, res.grading);
          rec = { pass: k, numTurns: res.numTurns ?? null, envelopeParsed: Boolean(res.envelopeParsed), decision };
          rec.grading = res.grading ?? null;
        } catch (e) {
          if (e instanceof SafetyError) throw e;
          rec = { pass: k, numTurns: null, envelopeParsed: false, decision: null, error: e?.message ?? String(e) };
        }
        const { grading: _omit, ...meta } = rec;
        holdJson(`${base}.meta.json`, meta);
        passRecords.push(rec);
        passesDone++;
        verifyArchives(baselines, `after ${label} pass ${k}`);
        const votes = rec.error
          ? "threw"
          : rec.decision.voided
            ? "VOID"
            : voteLine(rec.grading, query.expectations.length);
        log(`  ${label} pass ${k}/${passes}: ${votes}`);
      }

      // 4 and 5. Tally and flag.
      const t = tallyPasses({ passRecords, expectationCount: count, unverifiable });
      const archived = archivedVerdicts(archivedGrading);
      const mapped = mapArchived({ archived, map, currentCount: count });
      runs.push({
        label,
        runDir,
        archivedPresent: Boolean(archived),
        archivedSummary: archivedGrading?.summary ?? null,
        strip,
        passes: passRecords.map(({ grading: _g, ...p }) => p),
        voidPasses: t.voidCount,
        erroredPasses: t.errorCount,
        nonVoidPasses: t.voting,
        ungraded: t.ungraded,
        ungradedLabel: t.ungradedLabel,
        ties: t.ties,
        indices: t.indices.map((idx, i) => ({
          ...idx,
          text: query.expectations[i],
          archived: mapped.byCurrent[i].verdict,
          archivedFrom: mapped.byCurrent[i].from,
          flag: flagFor(mapped.byCurrent[i].verdict, idx.current),
        })),
        noCurrentIndex: mapped.noCurrentIndex,
      });
    }

    // 6. Write the tally and the report; print the summary.
    const incomplete = runs.some((r) => r.ungraded || r.erroredPasses > 0 || r.ties > 0);
    const tally = {
      tool: "scripts/skill-evals/routing/regrade.mjs",
      generatedAt: new Date().toISOString(),
      query,
      model,
      passes,
      map,
      unverifiable,
      outRoot: out,
      voidPasses: runs.reduce((a, r) => a + r.voidPasses, 0),
      erroredPasses: runs.reduce((a, r) => a + r.erroredPasses, 0),
      runs,
      perIndex: summarizeIndices(runs, query.expectations),
      status: incomplete ? EXIT.INCOMPLETE : EXIT.OK,
    };
    flush();
    writeJson(path.join(out, "tally.json"), tally);
    write(path.join(out, "report.md"), renderReport(tally));
    log(`\nRe-grade of ${query.queryId}: ${runs.length} run(s) x ${passes} pass(es), model ${model}`);
    for (const r of runs) log(`  ${r.label}: ${r.ungradedLabel ?? r.indices.map((i) => i.flag).join("  ")}`);
    for (const line of summaryLines(tally)) log(`  ${line}`);
    log(`  void passes: ${tally.voidPasses} · errored passes: ${tally.erroredPasses}`);
    log(`out: ${out}`);
    return {
      status: tally.status,
      message: incomplete ? "a run or an index is UNGRADED (too few non-void passes, or a tie), or a pass threw" : "",
      outRoot: out,
      tally,
    };
  }
}

function voteLine(grading, count) {
  return Array.from({ length: count }, (_, i) => (grading?.expectations?.[i]?.passed === true ? "P" : "F")).join("");
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

export const USAGE = `Re-grade archived routing runs with the stock grader (docs/strategy-skill-evals.md §6 step 5).

  node scripts/skill-evals/routing/regrade.mjs --runs <runDir> [<runDir>...] --query <queryId>
      [--passes ${DEFAULT_PASSES}] [--model <id>] [--map old:new,...] [--unverifiable i,j]
      [--out <dir>] [--keep-copies] [--ignore-stale-results]

  --runs           archived run folders (run-N); read only, never written
  --query          a queryId from routing-plan.mjs; its text is read from the working tree
  --passes         grader passes per run (default ${DEFAULT_PASSES})
  --model          grader model (default ${DEFAULT_MODEL})
  --map            1-based archived:current index map when a rewording moved indices
  --unverifiable   1-based current indices only a live sandbox could check
  --out            results folder (default <OS temp>/is-skill-eval-regrade-<random>; never in the repo)
  --keep-copies    keep the stripped copies the grader read
  --ignore-stale-results
                   start even though an earlier re-grade's output is still in the OS temp dir
                   (by default the tool refuses: the grader works beside it and could read it)

Exit: 0 done, 1 a run or index UNGRADED (or a tie) or a pass threw, 2 usage, 3 safety.`;

/** The CLI. Returns the exit code; only the direct-run guard below calls process.exit. */
export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`${e.message}\n\n${USAGE}`);
    return EXIT.USAGE;
  }
  if (opts.help || !argv.length) {
    console.log(USAGE);
    return EXIT.USAGE;
  }
  const { help: _help, ...rest } = opts;
  const result = await regrade(rest);
  if (result.message) (result.status === EXIT.OK ? console.log : console.error)(result.message);
  return result.status;
}

/**
 * True when this module is the script node was asked to run. Both sides are resolved through
 * junctions, symlinks and 8.3 names first: node reports the module by its real path, so a plain
 * text comparison made a run through a junction do nothing and exit 0.
 */
export function isDirectRun(argv1, moduleUrl = import.meta.url) {
  if (!argv1) return false;
  const real = (p) => realResolve(p).toLowerCase();
  return real(argv1) === real(fileURLToPath(moduleUrl));
}

if (isDirectRun(process.argv[1])) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e?.stack ?? String(e));
      process.exit(EXIT.INCOMPLETE);
    });
}
