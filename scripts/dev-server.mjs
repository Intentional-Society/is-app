#!/usr/bin/env node
// Thin wrapper around `next dev` so a worktree "lane" runs on its own port
// without typing --port every time. Next can't read PORT from .env (it binds
// the HTTP server before any env files load — see the Next CLI docs), so
// `make_lane_inside_worktree` writes LANE_DEV_PORT into the lane's .env.local
// and this passes it through as --port.
//
// An explicit --port/-p always wins (e.g. Playwright's web server runs
// `npm run dev -- --port <E2E_PORT>`); in that case we forward it untouched
// and add nothing. The base worktree has no LANE_DEV_PORT, so plain
// `npm run dev` behaves exactly as before (port 3000).

import { spawn } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const forwarded = process.argv.slice(2);
const hasExplicitPort = forwarded.some((a) => a === "--port" || a === "-p");
const lanePort = process.env.LANE_DEV_PORT;
const portArgs = !hasExplicitPort && lanePort ? ["--port", lanePort] : [];

const child = spawn("npx", ["next", "dev", ...portArgs, ...forwarded], {
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
