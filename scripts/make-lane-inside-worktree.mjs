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
//   is-app      -> lane 1 (the base worktree)
//   is-app-2    -> lane 2
//   is-app-3    -> lane 3
// Lane N shifts every port by N*100 and renames the Supabase project, so
// the existing dev:db / migrate / seed flow isolates itself with no other
// changes. This script is the one-time, in-place configure step you run
// AFTER `git worktree add` + `npm install` + `npm run setup`.
//
// A checkout where this script never ran keeps the Supabase default ports
// (54321…, dev 3000). Making the base worktree lane 1 frees those defaults
// for other Supabase projects.
//
// It writes only this worktree's .env.local (gitignored), so no tracked file
// changes:
//   - SUPABASE_PROJECT_ID, the SUPABASE_*_PORT values and the two auth URLs.
//     The Supabase CLI applies SUPABASE_<SECTION>_<KEY> env vars over
//     supabase/config.toml and loads .env.local itself.
//   - NEXT_PUBLIC_SUPABASE_URL and DATABASE_URL for the app, plus
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

// Base ports as committed in supabase/config.toml, each with the env var the
// CLI reads in its place. The env mapping is the CLI's config loader, not
// documented by Supabase: verified on CLI v2.122.0, so re-check it on a CLI
// upgrade. The CLI reads [inbucket] as [local_smtp], hence that env name.
const SUPABASE_PORTS = {
  api: { env: "SUPABASE_API_PORT", key: "port", base: 54321 },
  db: { env: "SUPABASE_DB_PORT", key: "port", base: 54322 },
  shadow: { env: "SUPABASE_DB_SHADOW_PORT", key: "shadow_port", base: 54320 },
  pooler: { env: "SUPABASE_DB_POOLER_PORT", key: "port", base: 54329 },
  studio: { env: "SUPABASE_STUDIO_PORT", key: "port", base: 54323 },
  inbucket: { env: "SUPABASE_LOCAL_SMTP_PORT", key: "port", base: 54324 },
  analytics: { env: "SUPABASE_ANALYTICS_PORT", key: "port", base: 54327 },
  inspector: { env: "SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT", key: "inspector_port", base: 8083 },
};
const APP_PORTS = { dev: 3000 };
const LANE_STRIDE = 100;
const MAX_LANE = 9; // N*100 keeps the 5432x block inside 543xx–544xx..552xx

function fail(msg) {
  process.stderr.write(`make-lane-inside-worktree: ${msg}\n`);
  process.exit(1);
}

function git(gitArgs) {
  return spawnSync("git", gitArgs, { cwd: repoRoot, encoding: "utf8" });
}

// `name` is the project name in package.json (the base worktree's dir name
// by convention). The bare name is lane 1; "<name>-N" is lane N. Lane 1 has
// no suffixed form, so a worktree can't claim the base worktree's ports.
const baseName = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")).name;
const worktreeName = nameOverride ?? basename(repoRoot);

function parseLane(dirName) {
  if (dirName === baseName) return 1;
  const m = dirName.match(new RegExp(`^${baseName}-(\\d+)$`));
  if (!m) {
    fail(
      `worktree dir "${dirName}" isn't a recognized lane name.\n` +
        `  Expected "${baseName}" (base, lane 1) or "${baseName}-<N>" (e.g. "${baseName}-2").\n` +
        `  Rename the worktree dir to set its lane, or pass --name=${baseName}-2 to preview.`,
    );
  }
  const lane = Number(m[1]);
  if (lane < 2 || lane > MAX_LANE) {
    fail(
      `lane ${lane} out of range (2–${MAX_LANE}); lane 1 is the base worktree ("${baseName}"), and higher lanes would overflow the reserved port blocks.`,
    );
  }
  return lane;
}

const lane = parseLane(worktreeName);
const off = lane * LANE_STRIDE;
const port = (p) => p.base + off;
const devPort = APP_PORTS.dev + off;

// --- supabase/config.toml (read only) --------------------------------------
function committedConfig() {
  const res = git(["show", "HEAD:supabase/config.toml"]);
  if (res.status !== 0) fail(`could not read HEAD:supabase/config.toml (${(res.stderr ?? "").trim()})`);
  return res.stdout;
}

// Offsets are relative to these base ports, so a base port that changed in
// config.toml must change here too. The (key, value) pair is unique per line.
function assertBasePorts(text) {
  for (const { key, base } of Object.values(SUPABASE_PORTS)) {
    if (!new RegExp(`^\\s*${key}\\s*=\\s*${base}\\b`, "m").test(text)) {
      fail(`expected "${key} = ${base}" in config.toml — has the stack config changed?`);
    }
  }
}

// site_url and the redirect allow-list point at the dev server; shift them to
// this lane's dev port so interactive auth flows resolve. (e2e reuses that
// same dev server and doesn't depend on the allow-list for the password-login
// flows the suite exercises.)
function laneAuthUrls(text) {
  const site = text.match(/^site_url\s*=\s*"([^"]*)"/m);
  const list = text.match(/^additional_redirect_urls\s*=\s*\[([^\]]*)\]/m);
  if (!site || !list) fail("expected site_url and additional_redirect_urls in config.toml's [auth] section");
  const shift = (url) => url.replace(":3000", `:${devPort}`);
  const redirects = [...list[1].matchAll(/"([^"]*)"/g)].map((m) => shift(m[1]));
  return { siteUrl: shift(site[1]), redirectUrls: redirects.join(",") };
}

// Lanes configured before the .env.local overrides had a rewritten
// config.toml hidden with --skip-worktree. Clearing the flag and restoring
// the committed file converts them in place.
function hasLegacyLaneConfig() {
  return git(["ls-files", "-v", "supabase/config.toml"]).stdout?.startsWith("S ") ?? false;
}

function restoreCommittedConfig() {
  for (const gitArgs of [
    ["update-index", "--no-skip-worktree", "supabase/config.toml"],
    ["restore", "supabase/config.toml"],
  ]) {
    const res = git(gitArgs);
    if (res.status !== 0) fail(`git ${gitArgs.join(" ")} failed (${(res.stderr ?? "").trim()})`);
  }
}

// --- .env.local -------------------------------------------------------------
function setEnvLine(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) return text.replace(re, line);
  const sep = text === "" || text.endsWith("\n") ? "" : "\n";
  return `${text}${sep}${line}\n`;
}

function laneEnv(config) {
  const { siteUrl, redirectUrls } = laneAuthUrls(config);
  return {
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port(SUPABASE_PORTS.api)}`,
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${port(SUPABASE_PORTS.db)}/postgres`,
    LANE_DEV_PORT: String(devPort),
    SUPABASE_PROJECT_ID: worktreeName,
    ...Object.fromEntries(Object.values(SUPABASE_PORTS).map((p) => [p.env, String(port(p))])),
    SUPABASE_AUTH_SITE_URL: siteUrl,
    SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS: redirectUrls,
  };
}

// --- apply ------------------------------------------------------------------
const config = committedConfig();
assertBasePorts(config);
const env = laneEnv(config);

const envPath = resolve(repoRoot, ".env.local");
if (!existsSync(envPath)) {
  fail(".env.local is missing — run `npm run setup` in this worktree first, then re-run this script.");
}
const legacy = hasLegacyLaneConfig();

const apiPort = port(SUPABASE_PORTS.api);
const studioPort = port(SUPABASE_PORTS.studio);
const portRows = [
  ["Supabase API / Kong", apiPort],
  ["Postgres", port(SUPABASE_PORTS.db)],
  ["Studio", studioPort],
  ["Inbucket (email)", port(SUPABASE_PORTS.inbucket)],
  ["next dev", devPort],
];
const summary =
  `Lane ${lane}  (project_id "${worktreeName}", port offset +${off})\n` +
  portRows.map(([label, p]) => `  ${label.padEnd(22)} ${p}`).join("\n") +
  `\n  Studio:        http://127.0.0.1:${studioPort}` +
  `\n  Interactive:   npm run dev        (auto-uses LANE_DEV_PORT=${devPort})` +
  `\n  e2e:           npm run test:e2e   (reuses the dev server on ${devPort})`;

if (dryRun) {
  process.stdout.write(
    `[dry-run] ${summary}\n\n[dry-run] would set in ${envPath}:\n` +
      Object.entries(env)
        .map(([k, v]) => `  ${k}=${v}`)
        .join("\n") +
      (legacy ? "\n[dry-run] would clear --skip-worktree on supabase/config.toml and restore the committed file" : "") +
      "\n",
  );
  process.exit(0);
}

let envText = readFileSync(envPath, "utf8");
for (const [key, value] of Object.entries(env)) envText = setEnvLine(envText, key, value);
writeFileSync(envPath, envText);
if (legacy) restoreCommittedConfig();

process.stdout.write(
  `${summary}\n\nConfigured${legacy ? " (and restored the committed supabase/config.toml)" : ""}. Start it with:  npm run dev\n` +
    `If this worktree's stack is already running on other ports, restart it first:  npm run dev:db:stop\n`,
);
process.stdout.write(
  `Windows only — reserve this lane's Supabase ports (admin shell, once):\n` +
    `  netsh int ipv4 add excludedportrange protocol=tcp startport=${apiPort} numberofports=7\n`,
);
