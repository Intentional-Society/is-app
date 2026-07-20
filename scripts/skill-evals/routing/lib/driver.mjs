// Executor + grader drivers. Both shell out to `claude -p`.
//
// Windows-native by construction: child stdout is consumed via async stream events
// (the event loop), never `select.select()` — that is the Windows-native equivalent of
// the "threaded pipe reader" the spec calls for (the vendored run_eval.py's `select()`
// crashes on native Windows; the no-patching rule applies only to the vendored dir).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Build the child env that reproduces a sandbox activation (env.json in the manifest):
 * prepend the stub bin/ to PATH, unset GH tokens, isolate GH_CONFIG_DIR, and remove
 * CLAUDECODE so a nested `claude -p` is permitted (matches vendored run_eval.py).
 */
export function sandboxEnv(manifest) {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  for (const k of manifest.env?.unset ?? []) delete env[k];
  for (const [k, v] of Object.entries(manifest.env?.set ?? {})) env[k] = v;
  const sep = process.platform === "win32" ? ";" : ":";
  env.PATH = `${manifest.env?.prependPath ?? manifest.binDir}${sep}${env.PATH ?? ""}`;
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

/**
 * Grade one run's transcript against its expectations, per agents/grader.md. Runs a
 * headless `claude -p` grader with cwd = runDir (so it can Read transcript.md + outputs/),
 * and requires it to print a single grading JSON object. The runner writes grading.json.
 * @returns {Promise<{grading:object|null, raw:string}>}
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
  const prompt = [
    "You are the Grader agent. Follow the role and grading criteria below EXACTLY.",
    "",
    "=== agents/grader.md (verbatim) ===",
    graderMd,
    "=== end agents/grader.md ===",
    "",
    "## This run",
    "- transcript_path: ./transcript.md (the model's response to the final user message — the graded turn)",
    "- outputs_dir: ./outputs (raw evidence: gh-calls.log, git-state.txt, gh-stub-state.json, observables.json)",
    "- The full raw event stream is ./raw.jsonl if you need it.",
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

  return new Promise((resolve, reject) => {
    const chunks = [];
    const errChunks = [];
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const child = spawn(
      "claude",
      ["-p", "--output-format", "json", "--model", model, "--allowedTools", "Read Grep Glob Bash"],
      { cwd: runDir, env, shell: false },
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => errChunks.push(c));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks).toString("utf8");
      let grading = null;
      try {
        const envelope = JSON.parse(raw);
        const text = typeof envelope.result === "string" ? envelope.result : raw;
        grading = extractJsonObject(text);
      } catch {
        grading = extractJsonObject(raw);
      }
      resolve({ grading, raw, stderr: Buffer.concat(errChunks).toString("utf8") });
    });
    child.stdin.end(prompt);
  });
}

/** Pull the first balanced top-level JSON object out of a text blob. */
export function extractJsonObject(text) {
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
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
