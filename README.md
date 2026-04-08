# is-app

Web application for [Intentional Society](https://intentionalsociety.org) — an authenticated app for a small, globally distributed membership network.

Live at **app.intentionalsociety.org**

## How the app works

A Next.js frontend talks to a Hono API backend, both running in the same codebase. Data lives in PostgreSQL (managed by Supabase), accessed via Drizzle ORM. Supabase also handles authentication. For local development, the entire Supabase stack runs in Docker on your machine.

## Getting started

### 1. Install prerequisites

Git, Node.js 22+, and Docker Desktop. See [docs/setup-dev-machine.md](docs/setup-dev-machine.md) for install instructions.

### 2. Clone and install

```bash
git clone https://github.com/Intentional-Society/is-app.git
cd is-app
npm install
```

### 3. Set up environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your local credentials. See the comments in `.env.example` for local Supabase values.

### 4. Run

```bash
npm run dev
```

This starts a local Supabase stack in Docker (Postgres, Auth, Studio), runs any pending database migrations, then launches the Next.js dev server at **http://localhost:3000**.

First run pulls Docker images and takes a few minutes. After that, startup is near-instant.

## Useful commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start Supabase + Next.js dev server |
| `npm run dev:db:stop` | Stop local Supabase containers |
| `npm run dev:db:reset` | Wipe local DB and reapply migrations |
| `npm test` | Run all tests (functional + e2e) |
| `npm run watch` | Vitest in watch mode |
| `npm run lint` | ESLint |

## Project structure

```
src/
  app/              Next.js pages and layouts
  app/api/          Catch-all route that delegates to Hono
  server/api.ts     Hono API routes (the backend)
  server/schema.ts  Drizzle database schema
  server/db.ts      Database connection
  lib/api.ts        Typed API client (apiClient) for frontend use
  lib/supabase/     Supabase auth helpers (server, client, middleware)
docs/               Architecture specs, strategy docs, config references
tests/              Functional and e2e tests
supabase/           Local Supabase config (config.toml)
drizzle/            Database migration files
```

## Documentation

| Doc | Description |
|-----|-------------|
| [architecture-appstack.md](docs/architecture-appstack.md) | Production stack and architecture decisions |
| [architecture-devstack.md](docs/architecture-devstack.md) | Dev/test tooling |
| [setup-dev-machine.md](docs/setup-dev-machine.md) | System prerequisites for new developers |
| [doc-strategy-branching.md](docs/doc-strategy-branching.md) | Branching strategy |
| [doc-strategy-committing.md](docs/doc-strategy-committing.md) | Commit conventions |
| [doc-sentry.md](docs/doc-sentry.md) | Sentry error tracking config |
| [doc-axiom.md](docs/doc-axiom.md) | Axiom logging config |
| [doc-vercel.md](docs/doc-vercel.md) | Vercel dashboard settings |
| [doc-github.md](docs/doc-github.md) | GitHub settings and CI workflows |
| [devjournal.md](docs/devjournal.md) | Development decision log |
