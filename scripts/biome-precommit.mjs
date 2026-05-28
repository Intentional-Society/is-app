#!/usr/bin/env node
// Pre-commit wrapper: lefthook hands us the staged files matching its glob,
// we invoke biome on them, and we append one JSONL stat line to
// .scratch/biome-precommit-stats.log recording whether the commit needed
// any reformatting.
//
// Why this exists: PR #307 chose NOT to add a per-edit Claude Code format
// hook (the npx-overhead of ~1s per Edit/Write was deemed too costly).
// The follow-up question is "are enough commits actually getting
// reformatted at pre-commit time that the per-edit hook would have
// been worth the overhead?" These stats answer that.
//
// Once we have enough data and the question is settled, delete this
// wrapper and point lefthook.yml at biome directly.

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const files = process.argv.slice(2);
if (files.length === 0) process.exit(0);

const result = spawnSync(
  "npx",
  ["biome", "check", "--write", "--no-errors-on-unmatched", "--files-ignore-unknown=true", ...files],
  { stdio: ["inherit", "pipe", "inherit"], shell: true },
);

const stdout = result.stdout?.toString("utf8") ?? "";
process.stdout.write(stdout);

// Biome's tail line is one of:
//   "Checked N files in Xms. Fixed M files."   (when fixes applied)
//   "Checked N files in Xms. No fixes applied."  (when clean)
const fixedMatch = stdout.match(/Fixed (\d+) files?\./);
const filesFixed = fixedMatch ? Number(fixedMatch[1]) : 0;

try {
  mkdirSync(resolve(".scratch"), { recursive: true });
  appendFileSync(
    resolve(".scratch/biome-precommit-stats.log"),
    `${JSON.stringify({
      ts: new Date().toISOString(),
      files_input: files.length,
      files_fixed: filesFixed,
    })}\n`,
  );
} catch {
  // Telemetry failure must never block a commit.
}

process.exit(result.status ?? 0);
