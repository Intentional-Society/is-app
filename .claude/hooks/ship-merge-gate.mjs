// PreToolUse gate on `gh pr merge` (registered in .claude/settings.json for Bash and
// PowerShell). Every merge an agent attempts asks a human, except a merge /ship has
// authorized on a machine that opted out of the merge confirmation:
//
//   1. `.claude/skip-merge-confirm.local` exists (per-machine opt-out, gitignored), and
//   2. `.claude/.ship-merge-authorized` holds `ship\t<ISO-8601 UTC>\t<PR#>`, written by
//      /ship step 12 after its doubt checks pass, no older than MARKER_TTL_MS, naming the
//      same PR as the command.
//
// The marker is single-use: any merge attempt deletes it. Merges outside /ship never
// carry one, so they always ask, opt-out or not.
//
// The hook returns "ask" explicitly instead of staying silent, because a silent hook
// leaves the call to the permission mode and auto mode's classifier would approve it.
// settings.json sets `onFailure: "block"`, so a crash or a missing script blocks the
// tool call; any error this script catches also resolves to "ask".

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OPT_OUT_FILE = path.join(".claude", "skip-merge-confirm.local");
export const MARKER_FILE = path.join(".claude", ".ship-merge-authorized");
export const MARKER_TTL_MS = 120_000;

const MERGE_RE = /\bgh(?:\.exe)?\s+pr\s+merge\b/gi;

/** The PR number a `gh pr merge` command targets, or null when it names none. */
export function mergeTarget(command) {
  const match = /\bgh(?:\.exe)?\s+pr\s+merge\b/i.exec(command);
  if (!match) return null;
  const rest = command
    .slice(match.index + match[0].length)
    .trim()
    .split(/\s+/);
  const arg = rest.find((token) => token && !token.startsWith("-"));
  if (!arg) return null;
  const cleaned = arg.replace(/^["']|["';]+$/g, "");
  if (/^\d+$/.test(cleaned)) return Number(cleaned);
  const url = /\/pull\/(\d+)(?:[/?#].*)?$/.exec(cleaned);
  return url ? Number(url[1]) : null;
}

function readMarker(markerPath) {
  let text;
  try {
    text = fs.readFileSync(markerPath, "utf8");
  } catch {
    return null;
  }
  fs.rmSync(markerPath, { force: true });
  const [owner, iso, pr] = text.trim().split("\t");
  return { owner, at: Date.parse(iso), pr: Number(pr) };
}

/**
 * Decide one tool call. Returns null for a command that isn't a merge, else
 * { decision: "ask" | "allow", reason }.
 */
export function decide({ command, projectDir, now = Date.now() }) {
  if (typeof command !== "string") return null;
  const merges = command.match(MERGE_RE);
  if (!merges) return null;

  const ask = (reason) => ({ decision: "ask", reason: `Merge gate: ${reason}` });
  const markerPath = path.join(projectDir, MARKER_FILE);

  if (!fs.existsSync(path.join(projectDir, OPT_OUT_FILE))) {
    fs.rmSync(markerPath, { force: true });
    return ask("merge confirmation is on (no .claude/skip-merge-confirm.local).");
  }
  const marker = readMarker(markerPath);
  if (merges.length > 1) return ask("more than one `gh pr merge` in one command.");
  const target = mergeTarget(command);
  if (target === null) return ask("the command names no PR number or URL.");
  if (!marker) {
    return ask("/ship did not authorize this merge (a merge outside /ship, or /ship raised a doubt).");
  }
  const age = now - marker.at;
  if (marker.owner !== "ship" || Number.isNaN(age) || age < -5_000 || age > MARKER_TTL_MS) {
    return ask("the /ship authorization is stale or malformed.");
  }
  if (marker.pr !== target) {
    return ask(`/ship authorized PR #${marker.pr}, but this command merges PR #${target}.`);
  }
  return {
    decision: "allow",
    reason: `Merge gate: /ship authorized PR #${target}; skip-merge-confirm opt-out present.`,
  };
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
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    result = decide({ command: input.tool_input?.command, projectDir });
  } catch (error) {
    result = { decision: "ask", reason: `Merge gate error, asking instead: ${error.message}` };
  }
  if (result) emit(result);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const ownPath = fileURLToPath(import.meta.url);
const same =
  process.platform === "win32" ? invokedPath.toLowerCase() === ownPath.toLowerCase() : invokedPath === ownPath;
if (same) main();
