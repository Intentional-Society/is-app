# Committing Strategy

## Before committing

If you touch code, have test coverage for it! Make sure you're keeping the docs and CLAUDE.md in sync with the state of the code as well.

If you've done work your teammates should know about, add a `docs/devjournal.md` entry (typically at a higher level than all the commit messages on that branch).

Run `npm test` (all suites) and confirm green before committing. Don't push code that you haven't tested locally. If you're changing frontend layout, check both phone and desktop rendering.

## Branch discipline

Always commit on a feature branch, never directly to `main`. PRs into `main` require CI to pass before merge.

## Schema and data migrations: expand-contract pattern

When a change touches the database schema or API response shape, deploy it in phases:

1. **Expand** — deploy a backend version that supports both the old and new shape. Add new columns/fields/endpoints alongside the old ones. Both old and new clients continue to work.
2. **Migrate** — update clients (frontend, mobile, etc.) to use the new shape. Deploy.
3. **Contract** — remove the old columns/fields/endpoints. Deploy.

Each phase is its own PR and deploy. Never combine expand and contract in a single deploy — that's the window where things break.

## AI-assisted commits

We allow and encourage AI coding support, but you are responsible for the quality of both the code changes and the commit message. Commits made fully by AI assistance include a `Co-Authored-By` trailer for attribution and traceability.
