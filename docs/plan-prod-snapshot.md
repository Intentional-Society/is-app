# Plan: Production database snapshot for local dev

## Goal

A script that copies production data into a developer's local Supabase Postgres, anonymizing PII in transit. Intended for when we have relational data worth testing against locally.

## Approach

`pg_dump` → anonymize → `pg_restore` into local Supabase Postgres.

## Steps

1. **`pg_dump` from prod** — connect via transaction pooler, dump to a file in custom format
2. **Anonymize** — run gonymizer (Go binary, no Python dependency) against the dump using a column map file that defines which fields to mask and how
3. **`pg_restore` to local** — restore the anonymized dump into `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

## Script design

- Node.js wrapper script in `scripts/snapshot-prod.ts` (or `.mjs`)
- Calls `pg_dump`, `gonymizer`, and `pg_restore` via `child_process.execSync`
- Reads prod connection string from env (not hardcoded)
- Column map file at `scripts/gonymizer-map.json` — committed to repo, updated as schema evolves
- npm script: `"snapshot:prod": "npx tsx scripts/snapshot-prod.ts"`

## Open questions

- Does gonymizer work on Windows? May need WSL or a Docker-based approach.
- Should the dump file be kept on disk (for sharing/caching) or cleaned up after restore?
- Subset support — do we need to limit the dump to N rows per table, or is the full dataset small enough?
- If Supabase ships an anonymized export feature (see https://github.com/orgs/supabase/discussions/33754), we may not need this at all.

## Prerequisites

- gonymizer installed (Go binary) or run via Docker
- Local Supabase running (`npm run dev:db`)
- Access to prod `DATABASE_URL`

