#!/usr/bin/env node
// Configure the CURRENT git worktree as an isolated "lane" so several
// worktrees can run `npm run dev` / `npm test` / `npm run test:e2e` in
// parallel without clobbering each other's database, auth, or ports.
//
// Background: the local Supabase stack is a singleton keyed by `project_id`
// (config.toml) on fixed host ports, and e2e wipes the DB via
// /api/_test/reset. Two worktrees sharing one stack therefore step on each
// other. GoTrue/Storage can't be multi-tenanted, so the only true isolation
// is one full stack per worktree — that's a "lane".
//
// A lane is derived from the worktree directory name:
//   is-app      -> lane 0 (the base worktree; left untouched)
//   is-app-2    -> lane 2
//   is-app-3    -> lane 3
// Lane N shifts every port by N*100 and renames the Supabase project, so
// the existing dev:db / migrate / seed flow isolates itself with no other
// changes. This script is the one-time, in-place configure step you run
// AFTER `git worktree add` + `npm install` + `npm run setup`.
//
// What it rewrites IN THIS WORKTREE ONLY (git worktrees have their own
// checked-out files and their own index):
//   - supabase/config.toml : project_id + every port + auth redirect URLs,
//     then `git update-index --skip-worktree` so the local edit never shows
//     as a diff or gets committed. The base text is taken from `git show
//     HEAD:supabase/config.toml`, so re-running always re-derives cleanly.
//   - .env.local           : the Supabase API + DATABASE_URL ports, plus
//     LANE_DEV_PORT — the port `npm run dev` binds, which the e2e suite reuses
//     (playwright.config.ts targets it instead of starting a second server).
//
// Local Supabase keys are deterministic across stacks (fixed demo JWT
// secret), so only URLs/ports change — never the keys.
//
// Flags:
//   --dry-run         print the planned changes; write nothing, touch no git
//   --name=<dirname>  pretend the worktree is named <dirname> (preview/testing)

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const nameOverride = args.find((a) => a.startsWith("--name="))?.slice("--name=".length);

// Base port assignments straight out of supabase/config.toml + the app's
// dev (3000) port. Lane N adds N*100.
const SUPABASE_PORTS = {
  api: { key: "port", base: 54321 },
  db: { key: "port", base: 54322 },
  shadow: { key: "shadow_port", base: 54320 },
  pooler: { key: "port", base: 54329 },
  studio: { key: "port", base: 54323 },
  inbucket: { key: "port", base: 54324 },
  analytics: { key: "port", base: 54327 },
  inspector: { key: "inspector_port", base: 8083 },
};
const APP_PORTS = { dev: 3000 };
const LANE_STRIDE = 100;
const MAX_LANE = 9; // N*100 keeps the 5432x block inside 543xx–544xx..552xx

function fail(msg) {
  process.stderr.write(`make-lane-inside-worktree: ${msg}\n`);
  process.exit(1);
}

// `name` is the project name in package.json (the base worktree's dir name
// by convention). Lane is the trailing -N on the current dir; bare name = 0.
const baseName = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")).name;
const worktreeName = nameOverride ?? basename(repoRoot);

function parseLane(dirName) {
  if (dirName === baseName) return 0;
  const m = dirName.match(new RegExp(`^${baseName}-(\\d+)$`));
  if (!m) {
    fail(
      `worktree dir "${dirName}" isn't a recognized lane name.\n` +
        `  Expected "${baseName}" (base, lane 0) or "${baseName}-<N>" (e.g. "${baseName}-2").\n` +
        `  Rename the worktree dir to set its lane, or pass --name=${baseName}-2 to preview.`,
    );
  }
  const lane = Number(m[1]);
  if (lane < 1 || lane > MAX_LANE) {
    fail(`lane ${lane} out of range (1–${MAX_LANE}); higher lanes would overflow the reserved port blocks.`);
  }
  return lane;
}

const lane = parseLane(worktreeName);
const off = lane * LANE_STRIDE;

if (lane === 0) {
  process.stdout.write(
    `This is the base worktree ("${baseName}", lane 0) — it keeps the default ports, nothing to configure.\n` +
      `  Create a lane with:  git worktree add ../${baseName}-worktrees/${baseName}-2 && cd … && npm install && npm run setup && npm run make_lane_inside_worktree\n`,
  );
  process.exit(0);
}

const port = (p) => p.base + off;
const apiPort = port(SUPABASE_PORTS.api);
const dbPort = port(SUPABASE_PORTS.db);
const studioPort = port(SUPABASE_PORTS.studio);
const inbucketPort = port(SUPABASE_PORTS.inbucket);
const devPort = APP_PORTS.dev + off;

// --- supabase/config.toml -------------------------------------------------
// Re-derive from the committed version so repeated runs are idempotent and
// never compound on an already-laned file.
function pristineConfig() {
  const res = spawnSync("git", ["show", "HEAD:supabase/config.toml"], { cwd: repoRoot, encoding: "utf8" });
  if (res.status !== 0) fail(`could not read HEAD:supabase/config.toml (${(res.stderr ?? "").trim()})`);
  return res.stdout;
}

function setPort(text, { key, base }) {
  // The (key, value) pair is unique per line — value disambiguates the
  // several `port = …` keys — so this targets exactly one line. Throwing on
  // a miss surfaces config.toml drift instead of silently producing a lane
  // that overlaps the base ports.
  const re = new RegExp(`^(\\s*${key}\\s*=\\s*)${base}\\b`, "m");
  if (!re.test(text)) fail(`expected "${key} = ${base}" in config.toml — has the stack config changed?`);
  return text.replace(re, `$1${base + off}`);
}

function buildConfig() {
  let text = pristineConfig();
  text = text.replace(/^(\s*project_id\s*=\s*)"[^"]*"/m, `$1"${worktreeName}"`);
  for (const def of Object.values(SUPABASE_PORTS)) text = setPort(text, def);
  // Auth redirect allow-list + site_url point at the dev server; shift them
  // to this lane's dev port so interactive auth flows resolve. (e2e reuses
  // that same dev server and doesn't depend on the allow-list for the
  // password-login flows the suite exercises.)
  text = text.replaceAll(":3000", `:${devPort}`);
  return text;
}

// --- .env.local -----------------------------------------------------------
function setEnvLine(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) return text.replace(re, line);
  const sep = text === "" || text.endsWith("\n") ? "" : "\n";
  return `${text}${sep}${line}\n`;
}

function buildEnv() {
  const envPath = resolve(repoRoot, ".env.local");
  if (!existsSync(envPath)) {
    fail(".env.local is missing — run `npm run setup` in this worktree first, then re-run this script.");
  }
  let text = readFileSync(envPath, "utf8");
  text = setEnvLine(text, "NEXT_PUBLIC_SUPABASE_URL", `http://127.0.0.1:${apiPort}`);
  text = setEnvLine(text, "DATABASE_URL", `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`);
  text = setEnvLine(text, "LANE_DEV_PORT", String(devPort));
  return { envPath, text };
}

// --- apply ----------------------------------------------------------------
const configText = buildConfig();
const { envPath, text: envText } = buildEnv();
const configPath = resolve(repoRoot, "supabase", "config.toml");

const portRows = [
  ["Supabase API / Kong", apiPort],
  ["Postgres", dbPort],
  ["Studio", studioPort],
  ["Inbucket (email)", inbucketPort],
  ["next dev", devPort],
];
const summary =
  `Lane ${lane}  (project_id "${worktreeName}", port offset +${off})\n` +
  portRows.map(([label, p]) => `  ${label.padEnd(22)} ${p}`).join("\n") +
  `\n  Studio:        http://127.0.0.1:${studioPort}` +
  `\n  Interactive:   npm run dev        (auto-uses LANE_DEV_PORT=${devPort})` +
  `\n  e2e:           npm run test:e2e   (reuses the dev server on ${devPort})`;

if (dryRun) {
  process.stdout.write(`[dry-run] ${summary}\n\n[dry-run] would rewrite supabase/config.toml and ${envPath}\n`);
  process.exit(0);
}

writeFileSync(configPath, configText);
writeFileSync(envPath, envText);

// Keep the local config.toml edit out of git: this worktree's index only.
const skip = spawnSync("git", ["update-index", "--skip-worktree", "supabase/config.toml"], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (skip.status !== 0) {
  process.stderr.write(
    `  warning: could not set --skip-worktree on supabase/config.toml (${(skip.stderr ?? "").trim()}).\n` +
      `  The lane still works, but git will show config.toml as modified. Run manually:\n` +
      `    git update-index --skip-worktree supabase/config.toml\n`,
  );
}

process.stdout.write(`${summary}\n\nConfigured. Start it with:  npm run dev\n`);
process.stdout.write(
  `Windows only — reserve this lane's Supabase ports (admin shell, once):\n` +
    `  netsh int ipv4 add excludedportrange protocol=tcp startport=${SUPABASE_PORTS.shadow.base + off} numberofports=10\n`,
);
