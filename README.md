# is-app

Web application for [Intentional Society](https://intentionalsociety.org) — an authenticated app for a small, globally distributed membership network.

Live at **app.intentionalsociety.org**

## Getting started

### Prerequisites

- Node.js 22+
- Docker Desktop (for local Supabase stack)
- See [docs/setup-dev-machine.md](docs/setup-dev-machine.md) for full setup details

### Run locally

```bash
npm install
cp .env.example .env.local   # then fill in local values (see comments in file)
npm run dev                   # starts local Supabase + Next.js dev server
```

On first run, Docker will pull Supabase images (~2-5 min). After that, startup is near-instant.

### Useful commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start local Supabase (if needed) + Next.js dev server |
| `npm run dev:db:stop` | Stop local Supabase containers |
| `npm run dev:db:reset` | Wipe local DB and reapply migrations |
| `npm test` | Run all tests (functional + e2e) |
| `npm run watch` | Vitest in watch mode |

## Documentation

| Doc | Description |
|-----|-------------|
| [setup-dev-machine.md](docs/setup-dev-machine.md) | System prerequisites for new developers |
| [architecture-appstack.md](docs/architecture-appstack.md) | Production stack (Next.js, Hono, Drizzle, Supabase) |
| [architecture-devstack.md](docs/architecture-devstack.md) | Dev/test tooling (Vitest, Playwright, etc.) |
| [doc-strategy-branching.md](docs/doc-strategy-branching.md) | Branching strategy |
| [doc-strategy-committing.md](docs/doc-strategy-committing.md) | Commit conventions and expand-contract pattern |
| [doc-vercel.md](docs/doc-vercel.md) | Vercel dashboard settings |
| [doc-github.md](docs/doc-github.md) | GitHub settings and CI workflows |
| [devjournal.md](docs/devjournal.md) | Development decision log |
