#!/usr/bin/env node
// One-time setup for new developers. Safe to re-run — every step is idempotent.
// Extend by adding more step functions below and calling them from main().
// This script is the canonical place for required local setup gaps that
// `npm install` does not cover, plus selected defense-in-depth checks that keep
// local workflow tooling reliable.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

function ensureLefthookInstalled() {
  // Wires lefthook's binary into .git/hooks. Re-running is a no-op.
  // Note: lefthook's own postinstall already does this during `npm install`
  // (skipped only when CI=true). Calling it here too is deliberate
  // defense-in-depth: missing hooks are a silent local quality failure.
  const result = spawnSync("npx", ["lefthook", "install"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    console.error("  lefthook install failed — pre-commit formatting will not run");
    process.exit(1);
  }
}

function ensurePlaywrightBrowsersInstalled() {
  // Playwright's npm package does not install browser binaries. The e2e suite
  // uses Chromium only, so keep setup lean by installing just that browser.
  const result = spawnSync("npx", ["--no-install", "playwright", "install", "chromium"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    console.error("  playwright browser install failed — e2e tests will not run");
    console.error("  Fix: run `npx playwright install chromium` and retry `npm run setup`.");
    process.exit(1);
  }
  console.log("  Playwright Chromium browser installed/current");
}

function ensureGitBlameIgnoreConfig() {
  // Make local `git blame` honor .git-blame-ignore-revs so the baseline
  // format-pass commit doesn't pollute blame for every reformatted file.
  // GitHub honors the file automatically; this configures the dev's local
  // git. Idempotent — re-running overwrites with the same value.
  const result = spawnSync("git", ["config", "blame.ignoreRevsFile", ".git-blame-ignore-revs"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  if (result.status !== 0) {
    console.error("  git config blame.ignoreRevsFile failed (non-fatal)");
    return;
  }
  console.log("  git blame.ignoreRevsFile set");
}

function ensureLocalEnv() {
  const target = resolve(repoRoot, ".env.local");
  const source = resolve(repoRoot, ".env.local.example");
  if (existsSync(target)) {
    console.log("  .env.local already exists — leaving it alone");
    console.log(
      "  (if tests complain about missing keys, run `node scripts/check-env.mjs` to list them, or with `--fix` to append them)",
    );
    return;
  }
  if (!existsSync(source)) {
    console.error("  .env.local.example is missing — cannot create .env.local");
    process.exit(1);
  }
  copyFileSync(source, target);
  console.log("  created .env.local from .env.local.example");
}

// The base Supabase stack binds 7 contiguous host ports, 54321–54327 (API,
// Postgres, Studio, Inbucket, and analytics at 54327; 54325/54326 are unused
// gaps). The shadow DB (54320) is only spun up transiently for `db diff` and
// the pooler (54329) is disabled, so neither is host-bound and neither needs
// reserving. Lanes shift this span by N*100 and get their reservation reminder
// from make_lane_inside_worktree (it knows the lane's ports at assignment), so
// this check runs in the base worktree only.
const SUPABASE_API_PORT = 54321;
const SUPABASE_BLOCK_SIZE = 7;

// A lane worktree is named "<package>-N" (e.g. is-app-2); the base worktree's
// directory matches the package name. Same signal make-lane-inside-worktree.mjs
// uses to derive the lane.
function isBaseWorktree() {
  const baseName = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")).name;
  return basename(repoRoot) === baseName;
}

function checkWindowsSupabasePortReservation() {
  // Windows hands out 49152–65535 as ephemeral ports, and the 54321–54327 span
  // sits inside that range. If a process grabs the API/Kong port before Docker
  // binds it, `supabase start` health-checks the squatter, gets a 404, and
  // rolls the whole stack back (issue #345). Reserving the span stops Windows
  // from auto-assigning those ports. This is detect-and-recommend only: the
  // `netsh add` needs an elevated shell and the ports free, so we never run it.
  const blockStart = SUPABASE_API_PORT;
  const blockEnd = blockStart + SUPABASE_BLOCK_SIZE - 1;

  const res = spawnSync("netsh", ["int", "ipv4", "show", "excludedportrange", "protocol=tcp"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (res.status !== 0 || typeof res.stdout !== "string") {
    console.log("  couldn't read reserved ranges via netsh — skipping (advisory only)");
    return;
  }

  // Each data row is "<startPort> <endPort>", sometimes with a trailing "*"
  // marking an administered (admin-added) exclusion — match the two leading
  // numbers and ignore the rest of the line. The union of rows is reserved.
  const ranges = [];
  for (const line of res.stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\b/);
    if (m) ranges.push([Number(m[1]), Number(m[2])]);
  }
  const isReserved = (p) => ranges.some(([s, e]) => p >= s && p <= e);

  // Any bound port in this span grabbed from the ephemeral range breaks
  // startup. 54321/Kong is the worst (silent 404-rollback); the rest fail
  // louder but still fail. List what's still open.
  const open = [];
  for (let p = blockStart; p <= blockEnd; p++) if (!isReserved(p)) open.push(p);

  if (open.length === 0) {
    console.log(`  Supabase ports ${blockStart}–${blockEnd} are reserved — good.`);
    return;
  }
  console.log(
    `  Supabase ports ${blockStart}–${blockEnd} are not fully reserved (open: ${open.join(", ")}).\n` +
      `  Windows can grab one — e.g. ${blockStart}/Kong — and 404-roll the stack on start.\n` +
      `  Reserve the span ONCE in an elevated PowerShell (stack stopped; survives reboots):\n` +
      `    netsh int ipv4 add excludedportrange protocol=tcp startport=${blockStart} numberofports=${SUPABASE_BLOCK_SIZE}\n` +
      `  Details: docs/setup-dev-machine.md`,
  );
}

function main() {
  console.log("Setting up is-app for local development...\n");

  console.log("1. Environment file");
  ensureLocalEnv();

  console.log("\n2. Playwright browser binaries");
  ensurePlaywrightBrowsersInstalled();

  console.log("\n3. Git hooks (lefthook)");
  ensureLefthookInstalled();

  console.log("\n4. Git blame ignore-revs config");
  ensureGitBlameIgnoreConfig();

  if (process.platform === "win32") {
    console.log("\n5. Windows Supabase port reservation (advisory)");
    if (isBaseWorktree()) {
      checkWindowsSupabasePortReservation();
    } else {
      console.log("  lane worktree — `npm run make_lane_inside_worktree` prints this lane's reservation command.");
    }
  }

  console.log("\nDone. Next: run `npm run dev` (Docker Desktop must be running).");
}

main();
