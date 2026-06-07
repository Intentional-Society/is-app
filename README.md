# is-app

Web application for [Intentional Society](https://intentionalsociety.org) — an authenticated app for a small, globally distributed membership network.

Live at **app.intentionalsociety.org**

## How the app works

A Next.js frontend talks to a Hono API backend, both running in the same codebase. Data lives in PostgreSQL (managed by Supabase), accessed via Drizzle ORM. Supabase also handles authentication. For local development, the entire Supabase stack runs in Docker on your machine.

## Getting started

### 1. Install prerequisites

Git, Node.js 24+, and Docker Desktop. See [docs/setup-dev-machine.md](docs/setup-dev-machine.md) for install instructions.

### 2. Clone and install

```bash
git clone https://github.com/Intentional-Society/is-app.git
cd is-app
npm install
```

### 3. Set up environment

```bash
npm run setup
```

Generates `.env.local` with the deterministic local Supabase defaults. Safe to re-run.

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
| `npm run lint` | Biome |

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

## Working with AI assistants

Three Claude Code Skills under [.claude/skills/](.claude/skills/) encode the team's check-in workflow. Invoke them explicitly by name:

- `/commit [issue-or-context]` — stage, test, draft a Conventional Commit-style message, bundled human approval, push.
- `/pr [PR#|URL|issue-or-context]` — fetch + rebase if needed, push, open or update the PR.
- `/ship [PR#|URL|issue-or-context]` — orchestrates the full chain (`/pr` → `/commit` as needed), waits for CI green, merges, watches `main`.

Design rationale and the full step lists are in [docs/spec-portable-ai-procedures.md](docs/spec-portable-ai-procedures.md).

## Documentation

| Doc | Description |
|-----|-------------|
| [architecture-appstack.md](docs/architecture-appstack.md) | Production stack and architecture decisions |
| [architecture-devstack.md](docs/architecture-devstack.md) | Dev/test tooling |
| [setup-dev-machine.md](docs/setup-dev-machine.md) | System prerequisites for new developers |
| [strategy-branching.md](docs/strategy-branching.md) | Branching strategy |
| [strategy-committing.md](docs/strategy-committing.md) | Commit conventions |
| [strategy-db-transactions.md](docs/strategy-db-transactions.md) | Writing transactions that survive the Supabase connection pooler |
| [strategy-project-management.md](docs/strategy-project-management.md) | GitHub Projects board conventions |
| [strategy-security.md](docs/strategy-security.md) | Security headers and rationale |
| [strategy-ui.md](docs/strategy-ui.md) | Theme tokens, Button variants, UI conventions |
| [design-welcome.md](docs/design-welcome.md) | Multi-step onboarding/welcome flow design |
| [design-emails.md](docs/design-emails.md) | Auth email template authoring and prod sync |
| [design-profile-pictures.md](docs/design-profile-pictures.md) | Avatar uploads, storage bucket, signed URLs |
| [design-relations.md](docs/design-relations.md) | The relationship web (schema, flows, rationale) |
| [design-buttondown.md](docs/design-buttondown.md) | Buttondown sync (program tag mirror, cron, write policy) |
| [doc-sentry.md](docs/doc-sentry.md) | Sentry error tracking config |
| [doc-axiom.md](docs/doc-axiom.md) | Axiom logging config |
| [doc-vercel.md](docs/doc-vercel.md) | Vercel dashboard settings |
| [doc-supabase.md](docs/doc-supabase.md) | Supabase dashboard settings (auth URLs, API keys) |
| [doc-resend.md](docs/doc-resend.md) | Resend transactional email (sending domain, DMARC) |
| [doc-github.md](docs/doc-github.md) | GitHub settings and CI workflows |
| [devjournal.md](docs/devjournal.md) | Development decision log |
