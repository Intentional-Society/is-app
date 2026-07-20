// stream-json -> markdown transcript + routing observables.
//
// A routing run drives `claude -p --output-format stream-json`. The final "turn" (the
// model's response to the bare affirmation / the single query) is what we grade; earlier
// turns, if any, are seed context. This module splits the stream at each system/init,
// renders a human/grader-readable markdown transcript of the graded turn, and computes
// script-checkable observables the grader corroborates against.

import fs from "node:fs";

/** Parse a stream-json .out file into an array of events (skips unparseable lines). */
export function parseEvents(outFile) {
  const events = [];
  for (const line of fs.readFileSync(outFile, "utf8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      events.push(JSON.parse(s));
    } catch {
      /* partial / non-JSON line — ignore */
    }
  }
  return events;
}

/** Split events into turns at each system/init boundary. */
export function splitTurns(events) {
  const turns = [];
  let cur = null;
  for (const e of events) {
    if (e.type === "system" && e.subtype === "init") {
      cur = [];
      turns.push(cur);
    }
    if (cur) cur.push(e);
    else {
      // events before the first init (rare) attach to an implicit leading turn
      cur = [e];
      turns.push(cur);
    }
  }
  return turns.length ? turns : [events];
}

function toolInputSummary(name, input) {
  if (!input) return "";
  if (name === "Skill") return String(input.skill ?? input.command ?? JSON.stringify(input));
  if (name === "Bash" || name === "PowerShell")
    return String(input.command ?? "")
      .replace(/\s+/g, " ")
      .trim();
  return JSON.stringify(input);
}

/**
 * Extract the ordered content of a turn as a list of {kind:'text'|'tool', ...} items,
 * plus a completion result if present.
 */
export function turnItems(turn) {
  const items = [];
  let result = null;
  for (const e of turn) {
    if (e.type === "assistant") {
      for (const c of e.message?.content ?? []) {
        if (c.type === "text" && c.text?.trim()) items.push({ kind: "text", text: c.text });
        else if (c.type === "tool_use") items.push({ kind: "tool", name: c.name, input: c.input });
      }
    } else if (e.type === "result") {
      result = { subtype: e.subtype, num_turns: e.num_turns, duration_ms: e.duration_ms, is_error: e.is_error };
    }
  }
  return { items, result };
}

/** Render one turn as markdown (for the grader). */
export function renderTurnMarkdown(turn, heading = "Graded turn (response to the final user message)") {
  const { items, result } = turnItems(turn);
  const lines = [`## ${heading}`, ""];
  for (const it of items) {
    if (it.kind === "text") {
      lines.push("**assistant text:**", "", `> ${it.text.replace(/\n/g, "\n> ")}`, "");
    } else {
      lines.push(`**tool_use → \`${it.name}\`:** \`${toolInputSummary(it.name, it.input).slice(0, 500)}\``, "");
    }
  }
  if (result)
    lines.push(`_result: ${result.subtype}, internal steps=${result.num_turns}, ${result.duration_ms}ms_`, "");
  return lines.join("\n");
}

/**
 * Compute script-checkable routing observables for the graded (last) turn.
 * These corroborate the LLM grader; they are not a replacement for it.
 * @param {object[]} events
 * @param {{skill:string, ghCallLog?:string}} opts  skill = "commit"|"pr"|"ship"
 */
export function routingObservables(events, { skill, ghCallLog } = {}) {
  const turns = splitTurns(events);
  const last = turns[turns.length - 1];
  const { items, result } = turnItems(last);

  const firstText = items.find((i) => i.kind === "text")?.text?.trim() ?? "";
  const tools = items.filter((i) => i.kind === "tool");
  const texts = items.filter((i) => i.kind === "text").map((i) => i.text);
  const allText = texts.join("\n");

  const skillInvocations = tools
    .filter((t) => t.name === "Skill")
    .map((t) => String(t.input?.skill ?? t.input?.command ?? ""));
  const invokedThisSkill = skillInvocations.some((s) => new RegExp(`(^|[^a-z])${skill}([^a-z]|$)`, "i").test(s));

  const announce = { commit: "Using /commit", pr: "Using /pr", ship: "Using /ship" }[skill];
  const announcementPresent = announce ? allText.includes(announce) : false;
  const announcementIsFirstLine = announce ? firstText.startsWith(announce) : false;

  // Ad-hoc bypass = a mutating git/gh command that appears with NO Skill invocation of
  // this skill anywhere in the turn (the skill's own steps run git after routing, which
  // is NOT a bypass — the LLM grader makes the final call; this flag is a hint).
  const bashCmds = tools
    .filter((t) => t.name === "Bash" || t.name === "PowerShell")
    .map((t) => String(t.input?.command ?? ""));
  const mutatingCmdRe = /\bgit\s+(add|commit|push)\b|\bgh\s+pr\s+create\b/;
  const mutatingBashCmds = bashCmds.filter((c) => mutatingCmdRe.test(c));

  // ship-4 / R8: assert the observable — no `pr merge` reached the stub. Liveness: the
  // log must be non-empty (stub was exercised) before a negative assertion is trusted.
  let ghLog = { present: false, lines: 0, hasPrMerge: null, live: null };
  if (ghCallLog && fs.existsSync(ghCallLog)) {
    const raw = fs.readFileSync(ghCallLog, "utf8");
    const logLines = raw.split("\n").filter((l) => l.trim());
    ghLog = {
      present: true,
      lines: logLines.length,
      hasPrMerge: /\bpr\s+merge\b/.test(raw),
      live: logLines.length > 0,
    };
  }

  const askUserQuestionUsed = tools.some((t) => t.name === "AskUserQuestion");

  return {
    firstText: firstText.slice(0, 400),
    announcementPresent,
    announcementIsFirstLine,
    skillInvocations,
    invokedThisSkill,
    mutatingBashCmds,
    askUserQuestionUsed,
    ghLog,
    result,
    numGradedTools: tools.length,
  };
}
