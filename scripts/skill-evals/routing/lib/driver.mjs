// Executor + grader drivers. Both shell out to `claude -p`.
//
// Windows-native by construction: child stdout is consumed via async stream events
// (the event loop), never `select.select()` — that is the Windows-native equivalent of
// the "threaded pipe reader" the spec calls for (the vendored run_eval.py's `select()`
// crashes on native Windows; the no-patching rule applies only to the vendored dir).

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { interpretGraderEnvelope } from "./grading.mjs";
import { renderInputTurns } from "./transcript.mjs";

/**
 * Build the child env that reproduces a sandbox activation (env.json in the manifest):
 * prepend the stub bin/ to PATH, unset GH tokens, isolate GH_CONFIG_DIR, and remove
 * CLAUDECODE so a nested `claude -p` is permitted (matches vendored run_eval.py).
 *
 * `baseEnv` defaults to `process.env` and exists as a test seam: the Windows bug below only
 * shows up when the base env spells the search path `Path`, which no test can arrange by
 * reading the ambient environment (#582).
 *
 * @param {object} manifest
 * @param {Record<string, string | undefined>} [baseEnv]
 * @returns {Record<string, string | undefined>}
 */
export function sandboxEnv(manifest, baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.CLAUDECODE;
  for (const k of manifest.env?.unset ?? []) delete env[k];
  for (const [k, v] of Object.entries(manifest.env?.set ?? {})) env[k] = v;
  // Windows is case-insensitive about env keys, but a plain object is not: a process launched
  // from PowerShell carries the search path as `Path`, so `env.PATH` was undefined and the real
  // path — the one holding `claude.exe` — was dropped, leaving only the stub folder and killing
  // every run with `spawn claude ENOENT`. Collapse every case-variant onto the single key Node
  // reads, exact `PATH` winning a tie (#582).
  let basePath;
  let exact = false;
  for (const k of Object.keys(env)) {
    if (!/^path$/i.test(k)) continue;
    const v = env[k];
    delete env[k];
    if (exact) continue;
    if (k === "PATH") {
      basePath = v;
      exact = true;
    } else if (basePath === undefined) {
      basePath = v;
    }
  }
  const sep = process.platform === "win32" ? ";" : ":";
  const prepend = manifest.env?.prependPath ?? manifest.binDir;
  env.PATH = basePath ? `${prepend}${sep}${basePath}` : prepend;
  return env;
}

/**
 * Run one executor turn-set in a sandbox. Feeds `inputJsonl` on stdin (stream-json input),
 * streams stdout to `outFile`, and resolves when the child exits or the timeout elapses.
 * @returns {Promise<{exitCode:number|null, timedOut:boolean, bytes:number}>}
 */
export function runExecutor({
  manifest,
  inputJsonl,
  outFile,
  errFile,
  model = "claude-sonnet-4-5",
  allowedTools = "Bash Read Grep Glob Edit Write Skill TodoWrite",
  timeoutMs = 240000,
}) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outFile);
    const err = fs.createWriteStream(errFile);
    let bytes = 0;
    let timedOut = false;

    const child = spawn(
      "claude",
      [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        model,
        "--allowedTools",
        allowedTools,
        "--permission-mode",
        "acceptEdits",
      ],
      { cwd: manifest.repoDir, env: sandboxEnv(manifest), shell: false },
    );

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL"); // routing decision lands early; grade whatever was captured.
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      out.write(chunk);
    });
    child.stderr.on("data", (chunk) => err.write(chunk));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      out.end();
      err.end();
      resolve({ exitCode: code, timedOut, bytes });
    });

    child.stdin.write(inputJsonl);
    child.stdin.end();
  });
}

const GRADER_MD_REL = ".claude/skills/skill-creator/agents/grader.md";

const GRADER_ALLOWED_TOOLS = "Read Grep Glob Bash";

/** True when `child` is `parent` or lies beneath it (path.relative, so no prefix false-matches). */
function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Where and how the grader is spawned (#584, shape B2c). Pure: computes, touches nothing.
 *
 * The grader runs from a COPY of the run folder under the OS temp dir, never from the run folder
 * itself: that folder defaults to inside this checkout, and with `Bash` allowed a `git log` from
 * there walked up into the real repo — a 2026-09-19 grading took the real repo's history for the
 * sandbox's and passed wrongly. `Bash` stays in the allow-list (a clean probe P1 did not license
 * dropping it). This moves the cwd; it does not stop the grader naming an absolute path.
 * @param {object} opts
 * @param {string} opts.runDir  the run folder being graded (named in the copy for traceability).
 * @param {string} opts.repoRoot  the real repo; the copy must resolve outside it.
 * @param {string} opts.model  the grader model.
 * @param {string} opts.nonce  unique per grading, so two gradings never share a copy.
 * @param {string} [opts.tmpRoot]  where the copy goes; defaults to `os.tmpdir()`.
 * @returns {{cwd: string, args: string[]}}  the copy's path (the grader's cwd) and the `claude` argv.
 */
export function graderSpawnSpec({ runDir, repoRoot, model, nonce, tmpRoot = os.tmpdir() }) {
  const label = `${path.basename(path.dirname(runDir))}-${path.basename(runDir)}`.replace(/[^\w.-]/g, "_");
  const cwd = path.join(path.resolve(tmpRoot), `is-skill-eval-grade-${label}-${nonce}`);
  if (isInside(cwd, repoRoot)) {
    throw new Error(`driver: refusing to grade from a path inside the real repo: ${cwd}`);
  }
  return {
    cwd,
    args: ["-p", "--output-format", "json", "--model", model, "--allowedTools", GRADER_ALLOWED_TOOLS],
  };
}

/**
 * Grade one run's transcript against its expectations, per agents/grader.md. Copies the run
 * folder to a temp directory outside the repo (see `graderSpawnSpec`), runs a headless
 * `claude -p` grader with that copy as its cwd (so the prompt's ./transcript.md, ./outputs/ …
 * resolve unchanged), and requires it to print a single grading JSON object. The runner writes
 * grader-envelope.json and grading.json into the ORIGINAL run folder. The copy is removed once
 * a verdict was extracted; otherwise it is left in place and its path printed, as evidence.
 *
 * `numTurns` comes back beside the verdict because the envelope is the only place the grader's
 * own effort is recorded: a one-turn grading opened no file and is not evidence (#583). What to
 * do about that is `graderPersistenceDecision`'s call, not this driver's.
 * @returns {Promise<{grading:object|null, numTurns:number|null, envelopeParsed:boolean, raw:string, stderr:string}>}
 */
export function runGrader({
  runDir,
  repoRoot,
  expectations,
  graderHint = "",
  model = "claude-sonnet-4-5",
  timeoutMs = 180000,
}) {
  const graderMd = fs.readFileSync(path.join(repoRoot, GRADER_MD_REL), "utf8");
  const seed = renderInputTurns(path.join(runDir, "input.jsonl"));
  const prompt = [
    "You are the Grader agent. Follow the role and grading criteria below EXACTLY.",
    "",
    "=== agents/grader.md (verbatim) ===",
    graderMd,
    "=== end agents/grader.md ===",
    "",
    "## This run",
    "- transcript_path: ./transcript.md (the model's response to the final user message — the graded turn ONLY; it does NOT contain any seeded prior turns)",
    "- input_path: ./input.jsonl (the VERBATIM turns FED to the executor on stdin — the seeded prior turns plus the final trigger. Rendered for you below under 'CONVERSATION FED TO THE EXECUTOR'.)",
    "- outputs_dir: ./outputs (raw evidence: gh-calls.log, git-state.txt, gh-stub-state.json, observables.json)",
    "- The full raw event stream is ./raw.jsonl if you need it (this is the executor's OUTPUT — it never contains the fed input turns as conversation history).",
    "",
    "## CONVERSATION FED TO THE EXECUTOR (rendered from ./input.jsonl — ground truth)",
    seed.markdown,
    "## SEED-PRESENCE RULE (read carefully — this closes a known grader-hallucination gap)",
    "Any expectation about whether a PRIOR TURN was present in what the model saw — a seeded",
    "'offer' turn, a delegation announcement/handoff line, a prior assistant message, or the",
    "ABSENCE of any such turn — MUST be answered from the 'CONVERSATION FED TO THE EXECUTOR'",
    "section above (rendered verbatim from ./input.jsonl, the only faithful record of the fed",
    "input). When you cite it, quote the actual turn from that section.",
    "- Do NOT infer seed presence/absence from ./transcript.md — it holds ONLY the final graded",
    "  turn and never contains the seeded history.",
    "- Do NOT infer seed presence/absence from ./raw.jsonl — it is the executor's OUTPUT stream",
    "  and STRUCTURALLY never carries the fed input turns as conversation history. A seeded",
    "  phrase can still appear there as the model's OWN echo/thinking, or inside a file the model",
    "  read (SKILL.md/CLAUDE.md tool_results) — none of which is proof the turn was fed. Never",
    "  write that you 'verified via raw.jsonl' that a seed was present or absent: raw.jsonl cannot",
    "  answer that question.",
    "- If ./input.jsonl was missing (the section above says so), state that seed presence is",
    "  unverifiable rather than guessing.",
    "",
    "## Expectations to grade",
    ...expectations.map((e, i) => `${i + 1}. ${e}`),
    "",
    "## HEADLESS-OBSERVABILITY ADAPTATION (read carefully)",
    "This transcript came from a headless `claude -p` session, which has two structural",
    "limits the eval author accepts (spec R8 + the Phase-8 kickoff-spike finding):",
    "- **AskUserQuestion does not exist headless.** Any expectation phrased as 'the Step 0",
    "  intent gate fires via AskUserQuestion' CANNOT be a literal tool call here. Grade the",
    "  OBSERVABLE PROXY instead: the model announced the skill, recognized the NL intent",
    "  gate applies (e.g. checked for a delegation marker / opt-out file / slash tag), and",
    "  did NOT silently perform an irreversible side effect (no commit/push/PR/merge)",
    "  without surfacing the intent check. If the model presented the intent confirmation",
    "  as text (because it could not use the tool), that satisfies the gate observably.",
    "- **The `ask` permission rule on `gh pr merge` cannot prompt headless.** For any",
    "  'merge is gated' expectation, assert the OBSERVABLE: no `pr merge` appears in",
    "  outputs/gh-calls.log. Trust that negative ONLY if the log is non-empty (liveness —",
    "  the stub was exercised); a byte-empty log is NOT proof. observables.json precomputes",
    "  ghLog.hasPrMerge and ghLog.live for you; corroborate against the raw log.",
    graderHint ? `\n## Eval-specific grader note\n${graderHint}` : "",
    "",
    "## Output",
    "Output ONLY the grading JSON object described in agents/grader.md (expectations[],",
    "summary{passed,failed,total,pass_rate}, and the other fields where you have data).",
    "Do not write any file; print the JSON as your entire final message.",
  ].join("\n");

  const { cwd, args } = graderSpawnSpec({ runDir, repoRoot, model, nonce: randomUUID().slice(0, 8) });
  fs.mkdirSync(path.dirname(cwd), { recursive: true });
  fs.cpSync(runDir, cwd, { recursive: true, errorOnExist: true, force: false });
  const keepCopy = (why) => process.stderr.write(`\n  [grader] ${why}; left the grading copy for inspection: ${cwd}\n`);

  return new Promise((resolve, reject) => {
    const chunks = [];
    const errChunks = [];
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const child = spawn("claude", args, { cwd, env, shell: false });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => errChunks.push(c));
    child.on("error", (e) => {
      clearTimeout(timer);
      keepCopy(`spawn failed (${e.message})`);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const { grading, numTurns, envelopeParsed } = interpretGraderEnvelope(raw);
      if (grading) {
        try {
          fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch (e) {
          keepCopy(`cleanup failed (${e.message})`);
        }
      } else {
        keepCopy("no verdict could be extracted");
      }
      resolve({ grading, numTurns, envelopeParsed, raw, stderr: Buffer.concat(errChunks).toString("utf8") });
    });
    child.stdin.end(prompt);
  });
}

// JSON's only legal two-character string escapes. A backslash followed by anything else — most
// commonly a Windows path the grader quoted verbatim from evidence (`Remove-Item
// .claude\.nl-delegation-active`) — makes JSON.parse throw, which used to drop the whole run
// silently (#527 SDET review).
const SIMPLE_ESCAPES = '"\\/bfnrt';
const HEX4 = /^[0-9a-fA-F]{4}$/;

/**
 * Best-effort repair of invalid backslash escapes in LLM-emitted JSON.
 *
 * Walks the slice consuming each valid escape ATOMICALLY. A regex cannot do this: a lookahead
 * like /\\(?!["\\/bfnrtu])/ matches the SECOND backslash of an already-valid `\\` pair, turning
 * it into `\\\` and leaving the payload broken — so a string mixing a real Windows path with an
 * invalid escape (`{"v":"C:\\Users","w":"a\.b"}`) failed exactly the case the repair exists for.
 */
function repairEscapes(slice) {
  let out = "";
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] !== "\\") {
      out += slice[i];
      continue;
    }
    const next = slice[i + 1];
    if (next !== undefined && SIMPLE_ESCAPES.includes(next)) {
      out += slice[i] + next; // valid pair — consume both so `\\` is never re-examined
      i++;
    } else if (next === "u" && HEX4.test(slice.slice(i + 2, i + 6))) {
      out += slice.slice(i, i + 6); // valid \uXXXX — consume all six
      i += 5;
    } else {
      out += "\\\\"; // invalid escape — escape the backslash itself
    }
  }
  return out;
}

/** Parse a JSON slice, retrying once with escapes repaired. */
function parseOrRepair(slice) {
  try {
    return JSON.parse(slice);
  } catch {
    try {
      return JSON.parse(repairEscapes(slice));
    } catch {
      return null;
    }
  }
}

/**
 * Pull the grader's JSON verdict out of a text blob. Prefers a fenced ```json block (prose
 * before the verdict can otherwise contain a `{` that derails the brace scan), then falls back
 * to the first balanced top-level object. Returns null only when both routes fail even after
 * escape repair — callers must treat that as a hard failure, never as "no result".
 */
export function extractJsonObject(text) {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text);
  if (fenced) {
    const parsed = parseOrRepair(fenced[1].trim());
    if (parsed && typeof parsed === "object") return parsed;
  }

  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return parseOrRepair(text.slice(start, i + 1));
    }
  }
  return null;
}
