# Parallel worktree "lanes"

Run several checkouts of this repo side by side — each on its own branch,
each able to run `npm run dev` / `npm test` / `npm run test:e2e` at the same
time without colliding. This is for working (or driving multiple agents) on
more than one branch at once, with shared git history and easy cross-branch
diffs.

## Why a "lane" is needed

The local Supabase stack is a singleton: it's keyed by `project_id` in
`supabase/config.toml` and binds fixed host ports, and the e2e suite wipes the
database via `/api/_test/reset`. Two checkouts pointed at one stack therefore
clobber each other's data and ports. GoTrue (auth) and Storage can't be
multi-tenanted, so the only real isolation is **one full Supabase stack per
worktree** — a _lane_.

A lane is just a port offset + a renamed Supabase project, derived from the
worktree's directory name:

| Dir name   | Lane | Offset |
| ---------- | ---- | ------ |
| `is-app`   | 1    | +100   |
| `is-app-2` | 2    | +200   |
| `is-app-3` | 3    | +300   |

| Service                     | Default           | Lane 1 | Lane 2 | Lane 3 |
| --------------------------- | ----------------- | ------ | ------ | ------ |
| Supabase API / Kong         | 54321             | 54421  | 54521  | 54621  |
| Postgres                    | 54322             | 54422  | 54522  | 54622  |
| Studio                      | 54323             | 54423  | 54523  | 54623  |
| Inbucket (email)            | 54324             | 54424  | 54524  | 54624  |
| shadow / analytics / pooler | 54320/54327/54329 | +100   | +200   | +300   |
| `next dev`                  | 3000              | 3100   | 3200   | 3300   |

A checkout where `make_lane_inside_worktree` never ran stays on the Supabase
defaults (the "Default" column). That's the single-checkout setup in
[doc-local-setup.md](doc-local-setup.md). Make the base worktree lane 1 when
you run lanes, or to free the defaults for other Supabase projects.

The e2e suite has no port of its own — it reuses the lane's `next dev` server
(see [Running in a lane](#running-in-a-lane)).

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

The base worktree becomes lane 1 the same way, minus the `worktree add`: stop
its stack (`npm run dev:db:stop`), then run `npm run make_lane_inside_worktree`
in `C:\All\code\is-app`. Its `project_id` stays `is-app`, so the database
volume and its data carry over to the new ports.

`make_lane_inside_worktree` reads the lane from the directory name and writes
this worktree's `.env.local` (gitignored) only. No tracked file changes, so
pulls, branch switches and `config.toml` edits work as in any checkout. It
sets:

- `SUPABASE_PROJECT_ID`, every `SUPABASE_*_PORT`, and
  `SUPABASE_AUTH_SITE_URL` / `SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS`. The
  Supabase CLI loads `.env.local` itself and applies `SUPABASE_<SECTION>_<KEY>`
  variables over `supabase/config.toml`. Supabase doesn't document this (it
  was verified on CLI v2.122.0), so `npm run dev:db` stops in a lane whose
  running stack reports a different API URL than `.env.local` expects;
- the Supabase API + `DATABASE_URL` ports for the app, and
  `LANE_DEV_PORT`, read by both the `npm run dev` wrapper
  (`scripts/dev-server.mjs`) and `playwright.config.ts`, so the dev server lands
  on this lane's port and the e2e suite targets that same port. Next can't take
  the port from `.env` directly — it binds before env files load — hence the
  wrapper.

Re-running the script is idempotent, and reads the working `config.toml`, so
uncommitted edits count. `npm run dev:db` warns when `config.toml`'s auth
URLs no longer match what the script wrote; re-run it, then restart the stack.

**A lane made by an earlier version** rewrote `config.toml` under
`--skip-worktree`, and a pull or rebase that changes `config.toml` stops on
that file. Convert it in this order, from the lane:

```sh
npm run dev:db:stop
git update-index --no-skip-worktree supabase/config.toml
git diff supabase/config.toml        # expect only project_id, ports and :3000 URLs
git restore supabase/config.toml
git switch --detach origin/main      # or pull / rebase your branch
npm run make_lane_inside_worktree
```

Run on a still-flagged lane, the script does the restore itself, and stops
instead when the file holds edits beyond that rewrite.

Local Supabase keys are identical across stacks (fixed demo JWT secret), so
only URLs/ports change. Preview a lane without writing anything:
`npm run make_lane_inside_worktree -- --name=is-app-2 --dry-run`.

## Running in a lane

After configuring, the normal commands "just work" against the lane's stack:

```sh
npm run dev                     # interactive dev server on this lane's port
npm run test:e2e                # reuses the dev server if up, else starts one
npm run test:functional         # isolated DB
```

**e2e reuses the dev server.** `playwright.config.ts` points its
`webServer`/`baseURL` at the lane's `next dev` port (`LANE_DEV_PORT`), so
`reuseExistingServer` runs the suite against a server you already have up — or
starts its own `npm run dev` on that port when none is. Two `next dev` instances
can't share one worktree's `.next` anyway, so a single server per lane is the
only workable shape; concurrent isolated dev+e2e is what separate _lanes_ are
for. A checkout that isn't a lane (no lane vars) falls back to port 3000.

**Tradeoff:** an e2e run resets and drives the seeded `@testfake.local` users in
the lane's dev DB (not your real account), so a manual dev session's test-user
state gets churned underneath it. This mirrors how CI runs against the
prod-backed preview, so it's the same model — but if you want a stable manual
session _and_ an e2e run at once, use two lanes (each lane is one Supabase stack
= one database).

## Reuse, teardown, caveats

- **Reuse a slot for another branch:** `git switch <branch>` inside the
  worktree (a branch checked out in another worktree is blocked by git — a
  guardrail, not a limit). The lane config is independent of the branch.
- **Footprint:** ~10 containers + ~2 GB RAM per lane. 2–4 lanes is comfortable
  on 16 GB+; beyond that, push e2e to CI (which already runs against per-branch
  Vercel previews) instead of adding local stacks.
- **Looping e2e (running the suite many times):** keep ONE `npm run dev` up and
  the loop reuses it automatically (that's the default now — see [Running in a
  lane](#running-in-a-lane)). Don't loop in a way that cold-starts the server
  each run: that tree-kills `next dev` between runs, and repeated kill-mid-compile
  corrupts the Turbopack `.next` cache until first-request route compilation
  outruns Playwright's `webServer` timeout (socket bound, never serving — the run
  fails before any test). One reused server ran 20 cycles clean; the cold-start
  loop cliffs after ~5. If a lane's `.next` wedges, delete it to rebuild.
- **Stop a lane's stack:** `npm run dev:db:stop` from that worktree.
- **Remove a lane:** `git worktree remove ../is-app-worktrees/is-app-2`.
- **Windows port grabbing:** reserve a lane's Supabase ports once in an admin
  shell (the script prints the exact command — lane 2 shown):
  `netsh int ipv4 add excludedportrange protocol=tcp startport=54521 numberofports=7`.
- **If a base port in `config.toml` changes:** the script derives lane ports
  from fixed base values and stops with an error when `config.toml` no longer
  matches them. Update `SUPABASE_PORTS` in the script, then re-run it in each
  lane.
