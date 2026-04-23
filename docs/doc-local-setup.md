# Local Development Setup

## Prerequisites

Install these once. See [setup-dev-machine.md](setup-dev-machine.md) for detailed instructions.

| Tool | Minimum version | Notes |
|------|-----------------|-------|
| Node.js | 22+ | Install via `nvm`; the repo's `.nvmrc` pins the version |
| Docker Desktop | latest | Must be **running** before `npm run dev` |
| Git | any | Mac: `xcode-select --install`; Windows: git-scm.com |

**Mac shortcut:**
```bash
nvm install 22        # installs Node.js 22 via nvm
nvm use               # switches to the version in .nvmrc
```

**Windows:** Allocate at least 7 GB RAM to Docker Desktop (Settings → Resources → Memory). WSL 2 backend required.

**Optional:** The [GitHub CLI](setup-dev-machine.md#github-cli) (`gh`) — Not required to run the app, but required for PR review / issue management from the terminal or Claude Code (web UI is the alternative, but only works for humans — Claude operates from the terminal).

---

## Clone and install

```bash
git clone https://github.com/Intentional-Society/is-app.git
cd is-app
npm install
```

---

## Generate the local environment file

```bash
npm run setup
```

This creates `.env.local` with the deterministic defaults that the local Supabase stack uses. Safe to re-run — it skips the file if it already exists. The generated values:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sb_publishable_...
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

`.env.local` is gitignored — never commit it.

---

## Start the dev server

Make sure Docker Desktop is running, then:

```bash
npm run dev
```

This single command:

1. Checks whether the local Supabase stack is already running (`supabase status`)
2. Starts Supabase containers if they aren't up yet (`supabase start`) — this pulls images and may take a minute on first run
3. Applies any pending Drizzle migrations (`drizzle-kit migrate`)
4. Starts the Next.js development server on **http://localhost:3000**

Supabase containers keep running after Ctrl+C. The Next.js server does not.

---

## Local service endpoints

| Service | URL | Purpose |
|---------|-----|---------|
| App | http://localhost:3000 | Next.js dev server |
| Supabase Studio | http://localhost:54323 | Database browser, table editor, SQL runner |
| Inbucket | http://localhost:54324 | Catches all outgoing auth emails (magic links, password resets) in development |
| Supabase API | http://localhost:54321 | Auth and PostgREST endpoints (used internally by the app) |
| Postgres | localhost:54322 | Direct database connection (user: `postgres`, pass: `postgres`, db: `postgres`) |

**Inbucket** is the local email inbox. Any email Supabase Auth sends during local development (magic links, email verification, password reset) is captured here instead of being delivered to a real address. Open http://localhost:54324 and click the recipient address to read it.

**Supabase Studio** provides a full database browser. Use it to inspect tables, run SQL queries, manage auth users, and browse logs during development.

---

## Database migrations

Migrations are managed by Drizzle Kit. The `npm run dev` script applies pending migrations automatically on startup. You can also run them manually:

```bash
npx drizzle-kit migrate          # apply pending migrations
```

To generate a new migration after changing the schema (`src/server/schema.ts`):

```bash
npx drizzle-kit generate         # generates SQL in drizzle/
npx drizzle-kit migrate          # applies it to the local database
```

To wipe the local database and start fresh:

```bash
npm run dev:db:reset             # resets the Supabase DB and re-runs all migrations
```

---

## Stopping the local stack

```bash
# Stop Supabase containers (Next.js stops when you Ctrl+C)
npm run dev:db:stop
```

Stopping is optional — the containers are lightweight and persist safely between development sessions. They do not start automatically on machine reboot; you need `npm run dev` (or `npm run dev:db` separately) each time.

---

## Troubleshooting

**Supabase containers fail to start**
: Docker Desktop must be running. Check `docker ps` to confirm it's up.

**Port conflicts**
: Ports 54321–54324 and 3000 must be free. Stop other Supabase projects or local Postgres instances that may be using them.

**Migration errors on startup**
: The `dev:db` script treats migration failures as non-fatal (`|| true`). If you see schema-related errors in the app, run `npx drizzle-kit migrate` manually to see the error output.

**`.env.local` has wrong values**
: Delete it and re-run `npm run setup` to regenerate from the known-good defaults.

---

## Seed development data

After starting local Supabase and running migrations, populate the database with realistic test data:

```bash
npm run seed:dev
```

This inserts 15 member profiles, 3 programs (The Gumball Machine, Presence Pods, Thematic Crews), 24 program memberships, and 5 invites representing a realistic invite chain. All records use fixed UUIDs so E2E tests can reference known values.

The script is idempotent — running it a second time produces no duplicates and reports how many rows were inserted vs skipped per table.
