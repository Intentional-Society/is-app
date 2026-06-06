# Parallel worktree "lanes"

Run several checkouts of this repo side by side — each on its own branch,
each able to run `npm run dev` / `npm test` / `npm run test:e2e` at the same
time without colliding. This is for working (or driving multiple agents) on
more than one branch at once, with shared git history and easy cross-branch
diffs.

## Why a "lane" is needed

The local Supabase stack is a singleton: it's keyed by `project_id` in
`supabase/config.toml` and binds fixed host ports, and the e2e suite binds a
fixed web-server port (3093) and wipes the database via `/api/_test/reset`.
Two checkouts pointed at one stack therefore clobber each other's data and
ports. GoTrue (auth) and Storage can't be multi-tenanted, so the only real
isolation is **one full Supabase stack per worktree** — a *lane*.

A lane is just a port offset + a renamed Supabase project, derived from the
worktree's directory name:

| Dir name   | Lane | Offset |
|------------|------|--------|
| `is-app`   | 0    | base ports, untouched |
| `is-app-2` | 2    | +200 |
| `is-app-3` | 3    | +300 |

| Service              | Base  | Lane 2 | Lane 3 |
|----------------------|-------|--------|--------|
| Supabase API / Kong  | 54321 | 54521  | 54621  |
| Postgres             | 54322 | 54522  | 54622  |
| Studio               | 54323 | 54523  | 54623  |
| Inbucket (email)     | 54324 | 54524  | 54624  |
| shadow / analytics / pooler | 54320/54327/54329 | +200 | +300 |
| `next dev`           | 3000  | 3200   | 3300   |
| e2e web server       | 3093  | 3293   | 3393   |

## Creating a lane

A `git worktree` shares the object store and refs with the main checkout (so
branches and commits are visible from either, and `git diff` works across
them), while living at a separate path. Per worktree, one time:

```sh
# from the main checkout (C:\All\code\is-app)
git worktree add ../is-app-worktrees/is-app-2     # the checkout; dir name sets the lane
cd ../is-app-worktrees/is-app-2
npm install                                       # node_modules isn't shared across worktrees
npm run setup                                     # generates this worktree's .env.local
npm run make_lane_inside_worktree                 # converts THIS worktree into lane 2
```

`make_lane_inside_worktree` reads the lane from the directory name and, in
this worktree only:

- rewrites `supabase/config.toml` — `project_id` + every port + the auth
  redirect URLs — re-deriving from the committed version each run (idempotent),
  then sets `git update-index --skip-worktree` so the edit never shows as a
  diff or gets committed;
- rewrites `.env.local` — the Supabase API + `DATABASE_URL` ports — and adds
  `E2E_PORT` (read by `playwright.config.ts`) + `LANE_DEV_PORT` (read by the
  `npm run dev` wrapper, `scripts/dev-server.mjs`) so both servers land on this
  lane's ports automatically. Next can't take the port from `.env` directly —
  it binds before env files load — hence the wrapper.

Local Supabase keys are identical across stacks (fixed demo JWT secret), so
only URLs/ports change. Preview a lane without writing anything:
`npm run make_lane_inside_worktree -- --name=is-app-2 --dry-run`.

## Running in a lane

After configuring, the normal commands "just work" against the lane's stack:

```sh
npm run dev                     # interactive dev server on this lane's port
npm run test:e2e                # auto-uses E2E_PORT; isolated DB + auth
npm run test:functional         # isolated DB
```

**One DB-touching activity per lane at a time.** A lane is a single Supabase
stack = a single database. The two app ports keep the dev server and the e2e
server from colliding, but they share the lane's DB — so running e2e *and* a
manual dev session in the **same** lane at once lets e2e's reset wipe the DB
under your session. Across lanes there's no interference at all; if you want a
stable manual session *and* an e2e run simultaneously, use two lanes.

## Reuse, teardown, caveats

- **Reuse a slot for another branch:** `git switch <branch>` inside the
  worktree (a branch checked out in another worktree is blocked by git — a
  guardrail, not a limit). The lane config is independent of the branch.
- **Footprint:** ~10 containers + ~2 GB RAM per lane. 2–4 lanes is comfortable
  on 16 GB+; beyond that, push e2e to CI (which already runs against per-branch
  Vercel previews) instead of adding local stacks.
- **Looping e2e (running the suite many times):** pre-start ONE lane server and
  reuse it — `npm run dev -- --port <E2E_PORT>`, which Playwright picks up via
  `reuseExistingServer`. Don't let each `playwright test` cold-start the server:
  that tree-kills `next dev` between runs, and repeated kill-mid-compile corrupts
  the Turbopack `.next` cache until first-request route compilation outruns
  Playwright's 60 s `webServer` timeout (socket bound, never serving — the run
  fails before any test). One reused server ran 20 cycles clean; the cold-start
  loop cliffs after ~5. If a lane's `.next` wedges, delete it to rebuild.
- **Stop a lane's stack:** `npm run dev:db:stop` from that worktree.
- **Remove a lane:** `git worktree remove ../is-app-worktrees/is-app-2`.
- **Windows port grabbing:** reserve a lane's Supabase block once in an admin
  shell (the script prints the exact command):
  `netsh int ipv4 add excludedportrange protocol=tcp startport=54520 numberofports=10`.
- **If `config.toml` changes upstream:** because the file is `--skip-worktree`
  in lanes, a pull won't update it there. Run `git update-index
  --no-skip-worktree supabase/config.toml`, pull, then re-run
  `npm run make_lane_inside_worktree` (it re-derives from the new base).
