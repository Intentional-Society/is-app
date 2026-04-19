#!/usr/bin/env node
// Ensure the local Supabase stack is running and ready.
//
// Handles a subtle race: when Docker Desktop cold-starts, it auto-boots
// persisted containers. `supabase status` during that window reports
// "container is not ready: starting" and `supabase start` refuses
// because a boot is already in progress. This script polls through
// that window before deciding whether to issue its own `supabase start`.

import { spawnSync } from "node:child_process";

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
  const start = spawnSync("npx", ["supabase", "start"], {
    stdio: "inherit",
    shell: true,
  });
  if (start.status === 0) return;

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
