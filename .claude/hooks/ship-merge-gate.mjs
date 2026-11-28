// PreToolUse gate on `gh pr merge` (registered in .claude/settings.json for Bash and
// PowerShell). Every merge an agent attempts asks a human, except a merge /ship has
// authorized on a machine that opted out of the merge confirmation:
//
//   1. `.claude/skip-merge-confirm.local` exists (per-machine opt-out, gitignored), and
//   2. `.claude/.ship-merge-authorized` holds `ship\t<ISO-8601 UTC>\t<PR#>`, written by
//      /ship step 12 after its doubt checks pass, no older than MARKER_TTL_MS, naming the
//      same PR as the command.
//
// Only a plain merge can skip the prompt: `gh pr merge <N> --merge --delete-branch`,
// optionally after `cd <this repo or a folder in it> &&`, with no other command, pipe,
// redirect or substitution. An allowed command skips every permission check (the prompt in
// default mode, the classifier in auto mode), so nothing may ride along with the merge; and
// `gh` picks the repository from the working directory, so `cd` may not leave this repo.
// Any other command mentioning `gh pr merge` asks and leaves the marker alone.
//
// The marker is single-use: a plain merge command deletes it. Merges outside /ship never
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

const MERGE_RE = /\bgh(?:\.exe)?\s+pr\s+merge\b/i;
const PLAIN_MERGE_RE = /^gh(?:\.exe)?\s+pr\s+merge\s+(\d+)\s+(?:--merge\s+--delete-branch|--delete-branch\s+--merge)$/i;
const CD_RE = /^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))$/i;
// Anything that could chain, pipe, redirect or substitute another command. `&&` is the one
// joiner allowed, so it is removed before this check.
const SHELL_CONTROL_RE = /[;|<>`&\r\n]|\$\(/;
// Endings models habitually append to a command, and that can't run anything else: merge
// stderr into stdout, or echo a fixed label with the exit status. Stripped before the checks.
const HARMLESS_SUFFIX_RE = /(?:\s+2>&1|\s*;\s*echo\s+"[\w\s=:.-]*\$\?[\w\s=:.-]*")$/;
const NOT_PLAIN =
  "only a plain `gh pr merge <N> --merge --delete-branch`, optionally after `cd <this repo> &&`, can skip the prompt.";

const GIT_BASH_DRIVE_RE = /^\/([a-z])(?=\/|$)/i;

function normalizeDir(dir) {
  if (process.platform !== "win32") return path.resolve(dir);
  // Git Bash spells C:\x as /c/x.
  return path.resolve(dir.replace(GIT_BASH_DRIVE_RE, "$1:")).toLowerCase();
}

function insideProject(dir, projectDir) {
  const root = normalizeDir(projectDir);
  const dest = normalizeDir(dir);
  return dest === root || dest.startsWith(root + path.sep);
}

/** Whether `cd <target>`, run from `fromDir`, lands inside `projectDir`. */
function staysInProject(target, fromDir, projectDir) {
  // A plain path only: the shell would expand anything else (`~`, `-`, `$VAR`, globs,
  // PowerShell's `(…)`), and the hook can't follow it. A backslash is a separator only on
  // Windows; elsewhere Bash reads it as an escape (`\.\.` is `..`), so it's refused there.
  const pathChars = process.platform === "win32" ? /^[\w.\-/\\: ]+$/ : /^[\w.\-/: ]+$/;
  if (!pathChars.test(target) || target.startsWith("-")) return false;
  // Git Bash spells C:\x as /c/x.
  const absolute = process.platform === "win32" ? target.replace(GIT_BASH_DRIVE_RE, "$1:") : target;
  return insideProject(path.resolve(fromDir, absolute), projectDir);
}

/**
 * Parse a command as a plain merge. Returns { pr } for `gh pr merge <N> --merge
 * --delete-branch`, optionally after `cd <dir inside projectDir> &&`; else { reason }.
 * `cwd` is the shell's working directory, when the hook input reports it.
 */
export function parsePlainMerge(command, projectDir, cwd = projectDir) {
  if (!insideProject(cwd, projectDir)) {
    return { reason: "the shell is in a directory outside this repo, so `gh` would merge another repo's PR." };
  }
  let core = command.trim();
  while (HARMLESS_SUFFIX_RE.test(core)) core = core.replace(HARMLESS_SUFFIX_RE, "");
  const segments = core.split(/\s*&&\s*/);
  if (segments.some((s) => SHELL_CONTROL_RE.test(s)) || segments.length > 2) return { reason: NOT_PLAIN };
  const merge = PLAIN_MERGE_RE.exec(segments.at(-1));
  if (!merge) return { reason: NOT_PLAIN };
  if (segments.length === 2) {
    const cd = CD_RE.exec(segments[0]);
    if (!cd) return { reason: NOT_PLAIN };
    if (!staysInProject(cd[1] ?? cd[2] ?? cd[3], cwd, projectDir)) {
      return { reason: "the command changes to a directory outside this repo before merging." };
    }
  }
  return { pr: Number(merge[1]) };
}

function readMarker(markerPath) {
  let text;
  try {
    text = fs.readFileSync(markerPath, "utf8");
  } catch {
    return null;
  }
  fs.rmSync(markerPath, { force: true });
  const [owner, iso, pr] = text.replace(/^﻿/, "").trim().split("\t");
  return { owner, at: Date.parse(iso), pr: Number(pr) };
}

/**
 * Decide one tool call. Returns null for a command that isn't a merge, else
 * { decision: "ask" | "allow", reason }.
 */
export function decide({ command, projectDir, cwd = projectDir, now = Date.now() }) {
  if (typeof command !== "string" || !MERGE_RE.test(command)) return null;

  const ask = (reason) => ({ decision: "ask", reason: `Merge gate: ${reason}` });
  // Not a plain merge (extra commands, other flags, a URL, a mention in an argument, a shell
  // outside this repo): ask, and leave any marker for the real merge.
  const plain = parsePlainMerge(command, projectDir, cwd);
  if (plain.pr == null) return ask(plain.reason);
  const target = plain.pr;
  const markerPath = path.join(projectDir, MARKER_FILE);

  if (!fs.existsSync(path.join(projectDir, OPT_OUT_FILE))) {
    fs.rmSync(markerPath, { force: true });
    return ask("merge confirmation is on (no .claude/skip-merge-confirm.local).");
  }
  const marker = readMarker(markerPath);
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
    const input = JSON.parse(fs.readFileSync(0, "utf8").replace(/^﻿/, ""));
    const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    result = decide({ command: input.tool_input?.command, projectDir, cwd: input.cwd || projectDir });
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
