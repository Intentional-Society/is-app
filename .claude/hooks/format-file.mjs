#!/usr/bin/env node
// Claude Code PostToolUse hook (Edit|Write): run `biome format --write` on the
// file just touched, so AI edits land already-formatted.
//
// Wired up in .claude/settings.json. Receives Claude's hook payload as JSON on
// stdin; extracts tool_input.file_path and shells out to biome. Always exits 0
// — formatter hiccups should never block Claude. Biome respects biome.json
// `includes`, so excluded files (drizzle/meta, tests/.../__data__) are no-ops.

import { spawnSync } from "node:child_process";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const raw = await readStdin();
  if (!raw.trim()) process.exit(0);

  const payload = JSON.parse(raw);
  const filePath = payload?.tool_input?.file_path;
  if (typeof filePath !== "string" || !filePath) process.exit(0);

  spawnSync("npx", ["biome", "format", "--write", filePath], {
    stdio: "ignore",
    shell: true,
    timeout: 25_000,
  });
} catch {
  // Swallow: hook must never block Claude.
}

process.exit(0);
