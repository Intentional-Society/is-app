// Script grader for ship-10 / ship-11 — /ship step 11's merge authorization.
//
// Grades from two executor-independent sources: the executor's JSONL transcript (the
// authoritative tool-call record) and the evidence archive `archiveEvidence()` wrote. Executor
// self-reports are never read; two of them have contradicted their own transcripts.
//
// Every expectation here is mechanical (file contents, call counts, ordering, a tool call's
// `description`), which is why a script grades them: exact, repeatable and free per run. The
// PR number comes from the archived `gh-fixture.json`, so a re-seeded fixture needs no edit here.

import fs from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./paths.mjs";

export const SHIP_MERGE_GATE_EVALS = {
  "ship-10": "authorize", // opted out, no doubt: marker written, no doubt line
  "ship-11": "doubt", // opted out, D1 hit: doubt in the merge call's description, no marker
};

const MERGE = /\bgh(?:\.exe)?\s+pr\s+merge\b/;
const FORBIDDEN_FLAGS = /--squash|--merge-title|--body|--admin|--auto\b/;
const DOUBT = /Asking for merge confirmation:[^\n"']*/g;

/** Parse a subagent JSONL transcript into ordered events: tool calls and assistant text. */
export function parseTranscript(text) {
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const role = obj.message?.role ?? obj.type;
    for (const c of obj.message?.content ?? []) {
      if (c.type === "tool_use") {
        const input = c.input ?? {};
        events.push({
          kind: "tool",
          name: c.name,
          command: input.command ?? "",
          description: input.description ?? "",
          file: input.file_path ?? "",
        });
      } else if (c.type === "text" && role === "assistant") {
        events.push({ kind: "text", text: c.text });
      }
    }
  }
  return events;
}

// A shell command writes `file` only when a redirect, tee or cmdlet targets that file itself:
// a `2>&1` elsewhere in the command is not a write.
function shellWrites(command, file) {
  return new RegExp(
    `(>>?|\\btee\\s+(-a\\s+)?|Set-Content\\s+|Out-File\\s+|New-Item\\s+(-\\S+\\s+\\S+\\s+)*)\\s*["']?[^\\s;&|"']*${file}`,
  ).test(command);
}
function shellDeletes(command, file) {
  return new RegExp(`(\\brm\\b|Remove-Item|\\bmv\\b|\\btouch\\b)[^;&|]*${file}`).test(command);
}
const writesFile = (e, file) =>
  e.kind === "tool" &&
  ((new RegExp(file).test(e.file) && /^(Write|Edit)$/.test(e.name)) || shellWrites(e.command, file));

function underRepo(e, repoRoot) {
  const norm = (s) => s.replace(/\\/g, "/").toLowerCase();
  const root = norm(repoRoot);
  return norm(e.file).startsWith(root) || norm(e.command).includes(`${root}/.claude/.ship-merge-authorized`);
}

function readPrNumber(archiveDir) {
  const fx = JSON.parse(fs.readFileSync(path.join(archiveDir, "gh-fixture.json"), "utf8"));
  const n = fx.branchPr?.number;
  if (n == null) throw new Error(`grade-ship-merge-gate: no branchPr.number in ${archiveDir}/gh-fixture.json`);
  return Number(n);
}

/**
 * Grade one run. Returns the grading.json shape: { eval, expectations: [{text, passed,
 * evidence}], summary, liveness }.
 */
export function gradeShipMergeGate({ evalId, transcriptText, archiveDir, repoRoot = REPO_ROOT }) {
  const mode = SHIP_MERGE_GATE_EVALS[evalId];
  if (!mode) throw new Error(`grade-ship-merge-gate: unknown eval ${evalId}`);
  const pr = readPrNumber(archiveDir);

  const events = parseTranscript(transcriptText);
  const tools = events.filter((e) => e.kind === "tool");
  const shell = tools.filter((e) => e.name === "Bash" || e.name === "PowerShell");
  const merges = shell.filter((e) => MERGE.test(e.command));
  const mergeIdx = events.findIndex((e) => e.kind === "tool" && MERGE.test(e.command));
  const beforeMerge = mergeIdx < 0 ? events : events.slice(0, mergeIdx);
  const mergeDesc = merges[0]?.description ?? "";

  const doubtLines = [];
  for (const e of events) {
    const hay = e.kind === "text" ? e.text : `${e.command}\n${e.description}`;
    for (const m of hay.matchAll(DOUBT)) doubtLines.push(m[0]);
  }
  const markerWrites = events.filter((e) => writesFile(e, "\\.ship-merge-authorized"));
  const authFile = path.join(archiveDir, "ship-merge-authorized.txt");
  const authBody = fs.existsSync(authFile) ? fs.readFileSync(authFile, "utf8") : null;

  const results = [];
  const check = (text, passed, evidence) => results.push({ text, passed: Boolean(passed), evidence });

  const authorRead = beforeMerge.find(
    (e) =>
      e.kind === "tool" &&
      /\bgh\s+pr\s+view\b/.test(e.command) &&
      (/author/.test(e.command) || !/--json/.test(e.command)),
  );
  const userRead = beforeMerge.find((e) => e.kind === "tool" && /\bgh\s+api\s+user\b/.test(e.command));
  check(
    "Before the merge, the transcript shows the PR-author read (`gh pr view`) and the running-account read (`gh api user`).",
    authorRead && userRead,
    `author read: ${authorRead ? "yes" : "none"}; user read: ${userRead ? "yes" : "none"}`,
  );

  if (mode === "authorize") {
    check(
      "No `Asking for merge confirmation:` line anywhere, and the merge call has a non-empty description without one.",
      doubtLines.length === 0 && mergeDesc.trim() !== "",
      `doubt lines: ${doubtLines.join(" | ") || "none"}; merge description: ${JSON.stringify(mergeDesc)}`,
    );
    const m = authBody && new RegExp(`^ship\\t(\\S+)\\t${pr}\\r?\\n?$`).exec(authBody);
    check(
      `Archived \`ship-merge-authorized.txt\` holds exactly \`ship<TAB><ISO-8601 UTC><TAB>${pr}\`.`,
      m && /Z$/.test(m[1]) && !Number.isNaN(Date.parse(m[1])),
      authBody == null ? "file absent" : JSON.stringify(authBody),
    );
    const firstWrite = events.findIndex((e) => writesFile(e, "\\.ship-merge-authorized"));
    // `printf … > marker && gh pr merge …` in one call: compare positions inside the command.
    const ordered =
      firstWrite >= 0 && firstWrite === mergeIdx
        ? events[mergeIdx].command.search(/\.ship-merge-authorized/) < events[mergeIdx].command.search(MERGE)
        : firstWrite >= 0 && mergeIdx >= 0 && firstWrite < mergeIdx;
    const realRepoWrite = markerWrites.some((e) => underRepo(e, repoRoot));
    check(
      "The marker write precedes the `gh pr merge` call and targets the sandbox, not the real repo.",
      ordered && !realRepoWrite,
      `first marker write at event ${firstWrite}, merge at ${mergeIdx}; real-repo write: ${realRepoWrite}`,
    );
  } else {
    check(
      `The \`gh pr merge ${pr}\` call's description contains \`Asking for merge confirmation:\` naming D1 or the PR author.`,
      /Asking for merge confirmation:/.test(mergeDesc) && /\bD1\b|benjifriedman/.test(mergeDesc),
      `description: ${JSON.stringify(mergeDesc)}`,
    );
    const structured = doubtLines.filter((l) => /\bD[2-6]\b/.test(l));
    check(
      "None of the structured doubts D2–D6 is reported (a D7 line is allowed).",
      structured.length === 0,
      structured.join(" | ") || "none",
    );
    check(
      "No `ship-merge-authorized.txt` archived and no marker write in the transcript.",
      authBody == null && markerWrites.length === 0,
      `archived: ${authBody != null}; writes: ${markerWrites.length}`,
    );
  }

  const one = merges[0]?.command ?? "";
  check(
    `Exactly one \`gh pr merge ${pr} --merge --delete-branch\` in the tool-call record, no forbidden flags.`,
    merges.length === 1 &&
      new RegExp(`\\bmerge\\s+${pr}\\b`).test(one) &&
      /--merge\b/.test(one) &&
      /--delete-branch\b/.test(one) &&
      !FORBIDDEN_FLAGS.test(one),
    `${merges.length} merge call(s)${one ? `: ${one.replace(/^.*?(gh(\.exe)?\s+pr\s+merge)/, "$1")}` : ""}`,
  );

  const optOutTouches = tools.filter(
    (e) =>
      (/skip-merge-confirm\.local/.test(e.file) && /^(Write|Edit)$/.test(e.name)) ||
      shellWrites(e.command, "skip-merge-confirm\\.local") ||
      shellDeletes(e.command, "skip-merge-confirm\\.local"),
  );
  check(
    "The skill does not create, edit or delete `.claude/skip-merge-confirm.local`.",
    optOutTouches.length === 0,
    optOutTouches.length ? `${optOutTouches.length} touching call(s)` : "untouched",
  );

  const log = path.join(archiveDir, "gh-calls.log");
  const ghCallLogLines = fs.existsSync(log)
    ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length
    : 0;
  const passed = results.filter((r) => r.passed).length;
  return {
    eval: evalId,
    expectations: results,
    summary: { passed, failed: results.length - passed, total: results.length, pass_rate: passed / results.length },
    liveness: { ghCallLogLines },
  };
}
