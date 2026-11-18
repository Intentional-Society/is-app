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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

import { laneAuthUrls } from "./lib/lane.mjs";

const PROJECT_ID = path.basename(process.cwd());
const GRACE_POLL_MS = 30_000; // wait for auto-starting containers first
const POST_START_POLL_MS = 90_000; // wait after issuing our own start
const POLL_INTERVAL_MS = 3_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The output of the last successful `supabase status -o env`, which checkLane
// reuses so a lane start doesn't pay for a second CLI call.
let lastStatusEnv = "";

const statusOk = () => {
  const res = spawnSync("npx", ["supabase", "status", "-o", "env"], { shell: true, encoding: "utf8" });
  lastStatusEnv = res.status === 0 ? (res.stdout ?? "") : "";
  return res.status === 0;
};

const pollUntilReady = async (budgetMs) => {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    if (statusOk()) return true;
  }
  return false;
};

const runSupabaseStart = () => {
  // Capture both streams so the caller can scan either for the
  // "container name already in use" conflict — the CLI is inconsistent
  // about which stream it picks (Windows shell: true makes it fuzzier).
  // Output is echoed live to the developer on the way out.
  const result = spawnSync("npx", ["supabase", "start"], {
    shell: true,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
};

const clearDanglingSupabaseContainers = () => {
  // Filter client-side: `docker ps --filter name=` is a substring match,
  // not regex, so earlier attempts at `supabase_.*_${PROJECT_ID}$` matched
  // nothing and recovery silently no-op'd. List all containers and match
  // names in JS instead.
  const list = spawnSync("docker", ["ps", "-a", "--format", "{{.Names}}"], { shell: true, encoding: "utf8" });
  if (list.status !== 0) {
    process.stderr.write(`docker ps failed (exit ${list.status}):\n${list.stderr ?? ""}\n`);
    return false;
  }
  const pattern = new RegExp(`^supabase_.+_${PROJECT_ID}$`);
  const names = (list.stdout ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((n) => pattern.test(n));
  if (names.length === 0) return false;
  process.stdout.write(`Removing ${names.length} dangling Supabase container(s): ${names.join(", ")}\n`);
  const rm = spawnSync("docker", ["rm", "-f", ...names], {
    stdio: "inherit",
    shell: true,
  });
  return rm.status === 0;
};

// A lane's project id and ports reach the CLI only as SUPABASE_* lines in
// .env.local, which the CLI applies over config.toml without Supabase
// documenting it. `supabase status` builds API_URL from that resolved config,
// not from the ports the containers bound, so a mismatch with .env.local means
// the CLI ignored the overrides; a stack still running on old ports passes.
// Also warn when config.toml's auth URLs changed after
// make_lane_inside_worktree wrote them.
const checkLane = () => {
  if (!existsSync(".env.local")) return;
  const env = parse(readFileSync(".env.local"));
  if (!env.LANE_DEV_PORT) return;

  // After a fresh `supabase start` no status has succeeded yet.
  if (!lastStatusEnv) statusOk();
  const apiUrl = lastStatusEnv.match(/^API_URL="?([^"\r\n]*)"?/m)?.[1];
  if (apiUrl !== env.NEXT_PUBLIC_SUPABASE_URL) {
    process.stderr.write(
      `This lane expects the Supabase API at ${env.NEXT_PUBLIC_SUPABASE_URL}, but the CLI reports ${apiUrl ?? "nothing"}.\n` +
        "The CLI may have ignored the SUPABASE_* overrides in .env.local (check its version), or .env.local changed by hand.\n" +
        "Re-run `npm run make_lane_inside_worktree`; see docs/strategy-worktree-lanes.md.\n",
    );
    process.exit(1);
  }

  const expected = laneAuthUrls(readFileSync("supabase/config.toml", "utf8"), env.LANE_DEV_PORT);
  if (expected && Object.entries(expected).some(([key, value]) => env[key] !== value)) {
    process.stdout.write(
      "Warning: config.toml's auth URLs changed since this lane was configured.\n" +
        "  Re-run `npm run make_lane_inside_worktree`, then `npm run dev:db:stop` and `npm run dev`.\n",
    );
  }
};

const ensureStackReady = async () => {
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

  // The Supabase CLI sometimes prints the docker-daemon conflict to
  // stdout rather than stderr (shell: true on Windows makes this
  // fuzzier), so we match against both.
  const combined = `${start.stdout ?? ""}\n${start.stderr ?? ""}`;
  if (/container name .* is already in use/i.test(combined)) {
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

  process.stderr.write("Supabase stack failed to become ready. " + "Try: npx supabase stop && npx supabase start\n");
  process.exit(1);
};

await ensureStackReady();
checkLane();
