// Path resolution + the load-bearing safety guard: sandboxes may NEVER live inside the
// real repo. Everything the harness writes goes under a temp/scratch root that
// assertOutsideRepo() proves is outside the repo working tree.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// lib/paths.mjs -> lib -> scripts/skill-evals (harness dir) -> scripts -> repo root.
export const HARNESS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO_ROOT = path.resolve(HARNESS_DIR, "..", "..");

// Marker filename that identifies a harness sandbox. "No marker, no run" (spec II.2c):
// eval execution and human_script use require this file to be present.
export const MARKER_FILENAME = ".skill-eval-sandbox";

// Prefix for every sandbox directory, so an audit can find (and a teardown can sweep) them.
export const SANDBOX_PREFIX = "skill-eval-";

/**
 * Root directory that holds all sandboxes. Defaults to the OS temp dir; override with
 * SKILL_EVAL_SANDBOX_ROOT (e.g. to point at a session scratchpad) or the --root CLI flag.
 * The returned path is always resolved and proven outside the repo before use.
 */
export function sandboxRoot(override) {
  const raw = override || process.env.SKILL_EVAL_SANDBOX_ROOT || path.join(os.tmpdir(), "skill-eval-sandboxes");
  return path.resolve(raw);
}

/**
 * Refuse any target that resolves to the repo root or anywhere inside it. This is the
 * structural guarantee that "the real repo is physically untouchable" (spec II.2b).
 */
export function assertOutsideRepo(target) {
  const resolved = path.resolve(target);
  const rel = path.relative(REPO_ROOT, resolved);
  const insideRepo = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (insideRepo) {
    throw new Error(
      `Refusing to use a sandbox location inside the real repo:\n  ${resolved}\n` +
        `Sandboxes must live under a temp/scratch dir outside ${REPO_ROOT}. ` +
        "Set SKILL_EVAL_SANDBOX_ROOT or pass --root to choose a safe location.",
    );
  }
  return resolved;
}

/** True if a directory looks like a harness sandbox (has the marker at repo/<MARKER>). */
export function isSandbox(dir) {
  return fs.existsSync(path.join(dir, "repo", MARKER_FILENAME)) || fs.existsSync(path.join(dir, MARKER_FILENAME));
}
