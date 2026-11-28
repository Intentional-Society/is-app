// PreToolUse merge gate (registered in .claude/settings.json for Bash and PowerShell).
//
// It never allows anything; it only decides whether a `gh pr merge` must ask a human. It
// asks for every command that mentions `gh pr merge`, unless all three hold:
//
//   1. `.claude/skip-merge-confirm.local` exists (per-machine opt-out, gitignored),
//   2. the most recent message the human typed in this session is `/ship`, and
//   3. the command's description starts with "Looks safe to me", which /ship writes only
//      when none of its doubt checks hit. Staying silent takes that positive statement, so
//      a model that skips a step gets a prompt rather than a silent merge.
//
// When it stays silent, Claude Code's own permission rules decide. /ship's `allowed-tools`
// grants exactly `gh pr merge <N> --merge --delete-branch` for the turn the human typed
// `/ship`, Claude Code checks each part of a compound command itself, and checked-in `ask`
// rules catch `--admin` and `--auto`. So a mistake here can only add a prompt or fail to add
// one; it can never grant a command.
//
// The hook returns "ask" explicitly instead of staying silent, because a silent hook leaves
// the call to the permission mode, and auto mode's classifier would approve a merge.
// settings.json sets `onFailure: "block"`, so a crash or a missing script blocks the tool
// call; any error this script catches also resolves to "ask".

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OPT_OUT_FILE = path.join(".claude", "skip-merge-confirm.local");
const MERGE_RE = /\bgh(?:\.exe)?\s+pr\s+merge\b/i;
const SHIP_COMMAND = "<command-name>/ship</command-name>";
export const SAFE_DECLARATION = "Looks safe to me";

// User entries Claude Code writes itself rather than the human: a background task finishing,
// a system reminder, a local command's output. Stored like typed text, so skipped by prefix.
const SYSTEM_WRITTEN_RE = /^\s*<(?:task-notification|system-reminder|local-command-[\w-]+)>/;

/**
 * The last message the human typed, from a Claude Code transcript (JSONL). Typed messages
 * are `user` entries that aren't `isMeta` (skill text Claude Code injects), aren't a
 * compaction summary or other system-written text, and carry no `tool_result` (tool output,
 * which other parties' text can reach). Returns "" when none.
 */
export function lastTypedMessage(transcriptText) {
  let last = "";
  for (const line of transcriptText.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user" || entry.isMeta || entry.isCompactSummary) continue;
    const content = entry.message?.content;
    let text = null;
    if (typeof content === "string") text = content;
    else if (Array.isArray(content) && !content.some((c) => c.type === "tool_result")) {
      text = content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    }
    if (text !== null && !SYSTEM_WRITTEN_RE.test(text)) last = text;
  }
  return last;
}

/**
 * Decide one tool call. Returns null for a command that isn't a merge, or when the gate
 * stays silent; else { decision: "ask", reason }. `description` is the tool call's own
 * description, which Claude Code shows above the command in the approval dialog.
 */
export function decide({ command, projectDir, transcriptPath, description = "" }) {
  if (typeof command !== "string" || !MERGE_RE.test(command)) return null;
  const ask = (reason) => ({ decision: "ask", reason: `Merge gate: ${reason}` });

  if (!fs.existsSync(path.join(projectDir, OPT_OUT_FILE))) {
    return ask("merge confirmation is on (no .claude/skip-merge-confirm.local).");
  }
  let typed = "";
  try {
    typed = lastTypedMessage(fs.readFileSync(transcriptPath, "utf8"));
  } catch {
    return ask("could not read this session's transcript to confirm a typed /ship.");
  }
  if (!typed.includes(SHIP_COMMAND)) {
    return ask("the last message you typed isn't /ship, so this merge isn't covered by the opt-out.");
  }
  if (!String(description).trim().startsWith(SAFE_DECLARATION)) {
    return ask(`/ship didn't say this merge "${SAFE_DECLARATION}"; its description above says why it's asking.`);
  }
  return null;
}

function emit(result) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: result.decision,
        permissionDecisionReason: result.reason,
      },
    }),
  );
}

function main() {
  let result;
  try {
    const input = JSON.parse(fs.readFileSync(0, "utf8").replace(/^﻿/, ""));
    const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    result = decide({
      command: input.tool_input?.command,
      description: input.tool_input?.description,
      projectDir,
      transcriptPath: input.transcript_path,
    });
  } catch (error) {
    result = { decision: "ask", reason: `Merge gate error, asking instead: ${error.message}` };
  }
  if (result) emit(result);
}

// Run main() only when executed, not when imported by tests. Node resolves symlinks in its
// own module path, so compare real paths: a symlinked checkout must not skip the gate.
function realPath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
const invokedPath = process.argv[1] ? realPath(process.argv[1]) : "";
const ownPath = realPath(fileURLToPath(import.meta.url));
const same =
  process.platform === "win32" ? invokedPath.toLowerCase() === ownPath.toLowerCase() : invokedPath === ownPath;
if (same) main();
