# Biome Configuration

Biome is the linter + formatter. `npm run lint` runs `biome ci .`, and CI gates
it on every PR. Config lives in `biome.json`; this doc holds the rationale the
JSON itself can't carry.

## Updating Biome

`$schema` points at the locally installed copy
(`./node_modules/@biomejs/biome/configuration_schema.json`), so editor
validation tracks whatever version is installed — bumping `@biomejs/biome`
(e.g. via Dependabot) needs no edit to `biome.json`. This is deliberate: a
pinned `schemas/<version>/schema.json` URL silently drifts whenever the package
bumps but the URL doesn't, which CI flags as *"configuration schema version
does not match"*.

After a bump, run `npm run lint` once to surface any renamed or newly
recommended rules.

## Notable config

- **App code can't import `@/server/*`** — the `noRestrictedImports` override on
  `src/app/**` and `src/components/**` forces app code through the Hono API
  (`apiClient` / `serverApiClient`) instead of reaching into server modules
  directly. See `architecture-appstack.md`.
- **Import order** — `organizeImports` groups node/package builtins, then `@/`
  aliases, then relative paths, with blank lines between each group.
- **shadcn UI a11y opt-outs** — `src/components/ui/**` disables
  `useSemanticElements` and `useKeyWithClickEvents`; those are generated
  components we don't hand-edit.
- **`noNonNullAssertion`** — an error in app code, relaxed to off under `tests/`
  and `scripts/`.
- **Excluded paths** — the `files.includes` negations skip generated or vendored
  trees Biome shouldn't touch: `.next`, `next-env.d.ts`, Supabase email
  templates, `docs/_temp-*`, `drizzle/meta`, and the functional-test
  `__data__` fixtures.
