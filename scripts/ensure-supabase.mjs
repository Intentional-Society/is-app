#!/usr/bin/env node
// Ensure the local Supabase stack is running and ready.
//
// Handles a subtle race: when Docker Desktop cold-starts, it auto-boots
// persisted containers. `supabase status` during that window reports
// "container is not ready: starting" and `supabase start` refuses
// because a boot is already in progress. This script polls through
// that window before deciding whether to issue its own `supabase start`.
//
// Also auto-recovers from dangling-container conflicts: if a prior
// `supabase stop` left orphaned `supabase_*_<project>` containers,
// `supabase start` fails with "container name already in use". We detect
// that, force-remove the offenders, and retry once.

import { spawnSync } from "node:child_process";
import path from "node:path";

const PROJECT_ID = path.basename(process.cwd());
const GRACE_POLL_MS = 30_000; // wait for auto-starting containers first
const POST_START_POLL_MS = 90_000; // wait after issuing our own start
const POLL_INTERVAL_MS = 3_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const statusOk = () =>
  spawnSync("npx", ["supabase", "status"], {
    stdio: "ignore",
    shell: true,
  }).status === 0;

const pollUntilReady = async (budgetMs) => {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    if (statusOk()) return true;
  }
  return false;
};

const runSupabaseStart = () => {
  // Capture stderr so we can detect the "container name already in use"
  // conflict, but also echo live output for the developer.
  const result = spawnSync("npx", ["supabase", "start"], {
    shell: true,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
};

const clearDanglingSupabaseContainers = () => {
  const list = spawnSync(
    "docker",
    ["ps", "-aq", "--filter", `name=supabase_.*_${PROJECT_ID}$`],
    { shell: true, encoding: "utf8" },
  );
  const ids = (list.stdout ?? "").split(/\s+/).filter(Boolean);
  if (ids.length === 0) return false;
  process.stdout.write(
    `Removing ${ids.length} dangling Supabase container(s)…\n`,
  );
  spawnSync("docker", ["rm", "-f", ...ids], {
    stdio: "inherit",
    shell: true,
  });
  return true;
};

const main = async () => {
  if (statusOk()) return;

  process.stdout.write("Supabase stack not ready — waiting for containers…\n");
  if (await pollUntilReady(GRACE_POLL_MS)) {
    process.stdout.write("Supabase stack ready.\n");
    return;
  }

  // Not coming up on its own — issue a start. `supabase start` blocks
  // until the stack is ready on the happy path.
  process.stdout.write("Starting Supabase stack…\n");
  let start = runSupabaseStart();
  if (start.status === 0) return;

  const stderr = start.stderr ?? "";
  if (/container name .* is already in use/i.test(stderr)) {
    if (clearDanglingSupabaseContainers()) {
      process.stdout.write("Retrying Supabase start…\n");
      start = runSupabaseStart();
      if (start.status === 0) return;
    }
  }

  // `supabase start` can report "already running" if it races a
  // concurrent boot. Give the stack another window to settle.
  if (await pollUntilReady(POST_START_POLL_MS)) {
    process.stdout.write("Supabase stack ready.\n");
    return;
  }

  process.stderr.write(
    "Supabase stack failed to become ready. " +
      "Try: npx supabase stop && npx supabase start\n",
  );
  process.exit(1);
};

main();
