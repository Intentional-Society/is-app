# Plan — TypeID adoption

Status: proposal, not started. Author: discussion captured 2026-05-02.

## Goal

Adopt [TypeID](https://github.com/jetify-com/typeid) (`prefix_01h…` strings, UUIDv7 inside) as the wire format for app-controlled UUID PKs. Primary wins are debuggability (self-describing IDs in logs, errors, psql, Sentry breadcrumbs) and a small step toward type safety on identifiers. Secondary win is K-sortable IDs (UUIDv7) which improves B-tree insert locality at scale.

## Constraints we discovered

- **Supabase `auth.users.id` is UUIDv4** and not ours to mint. Anything keyed on it (today: `profiles.id`) can't become a spec-conforming TypeID without rotating user accounts. This is a hard one-way door — once a user has a profile row, that ID is permanent.
- **TypeID v0.3 mandates UUIDv7.** The `typeid-js` library is permissive in practice and will round-trip a v4 inside a TypeID string, but a future major could tighten the validator. Treat v4-inside-TypeID as a known compromise, not a free design choice.
- **Postgres 15 (Supabase's default) has no native `uuidv7()`.** UUIDv7 generation has to come from app code or a custom SQL function we maintain.
- **No existing branded-type or ID-validation infrastructure.** The codebase uses plain `string` for IDs and a manual `UUID_RE` regex in one place (`src/server/programs.ts`). We're starting from zero.

## Design axes

Each axis has a default recommendation; the pros/cons are here so future-us can re-evaluate per-table or revisit globally.

### Axis 1 — Storage representation

| Option | Pros | Cons |
| --- | --- | --- |
| **`uuid` column, encode/decode at API boundary** (recommended) | 16 bytes; native Postgres indexing and FK semantics; no schema churn from prefix changes; prefix is implied by table | Prefix is convention, not enforced by storage; rows are not self-describing in raw psql |
| **`text` column storing the canonical TypeID string** | Self-describing in raw psql and exports; prefix mismatch is a constraint check away | ~30 bytes per ID; index is bigger; redundant prefix on every row and every FK; renaming a table's prefix is a data migration; FK joins are text→text |
| **`typeid` Postgres type via community extension** | Storage *and* wire are unified; type system enforces prefix at the DB | v0.3 community extension; not on Supabase by default; we'd own packaging/upgrades |

**Default: option 1.** Cheap, conventional, reversible. Only revisit if "wrong-prefix at DB layer" becomes a real bug source.

### Axis 2 — UUIDv7 generation site

| Option | Pros | Cons |
| --- | --- | --- |
| **App-side via `typeid-js`** (recommended) | No SQL extension; one dependency; tests and scripts use the same one-liner; works identically across local and prod | App must remember to set `id` on every insert; ad-hoc inserts via psql or admin tools won't get a v7 default |
| **DB-side `uuidv7()` function** | Column default keeps working; ad-hoc inserts get v7 for free | Custom SQL function to maintain through Supabase upgrades; one more thing that has to be present in fresh dev DBs |

**Default: app-side.** Until/unless Postgres ships native `uuidv7()` and Supabase picks it up, the SQL-side option is more moving parts than it's worth.

### Axis 3 — Scope (which tables get TypeID)

This is the axis most likely to shift over time as tables are added.

| Scope | Pros | Cons |
| --- | --- | --- |
| **Only tables we mint IDs for** (recommended) | Spec-compliant TypeIDs everywhere; no v4-inside-TypeID lock-in | A heterogeneous wire format — some IDs are TypeIDs, some are bare UUIDs |
| **Every UUID, including Supabase-pinned ones** | Uniform wire format; "every ID has a prefix" is a clean rule | `prof_…` and similar are non-conforming UUIDv4-inside-TypeID; permanent because `profile.id == auth.users.id` |
| **Selective per-table by privacy/auditing needs** | Fine-grained — e.g. encode IDs that show up in URLs, leave purely-internal ones bare | Higher mental tax; reviewers have to remember which tables are encoded |

**Default: only mint-we-own.** Convention: a UUID-shaped string in our API means "user/profile." Anything else gets a typed prefix. If that convention starts to feel surprising, revisit.

### Axis 4 — Type safety on the client

| Option | Pros | Cons |
| --- | --- | --- |
| **Plain `string` on RPC** (recommended initial) | Hono RPC infers this for free; zero friction | No compile-time check that the right ID type is passed to the right route |
| **Branded types (`TypeID<'prog'>`) end-to-end** | Compile-time prevents `getProgram(userId)` mistakes | Friction at every component prop, every RPC return, every test fixture; have to cast at JSON boundaries |

**Default: plain string for now.** Revisit if we ever ship a bug where the wrong ID got passed to the wrong route — that's the signal to add branding.

## Recommended approach (table-agnostic)

For every table we want to TypeID:

1. **Pick a prefix.** Snake-case, ≤63 chars, table-meaningful (`prog`, `inv`, `evt`, …). Document it in `src/server/schema.ts` next to the table definition.
2. **Drop `defaultRandom()` from the column.** Generation moves to the app. Drizzle migration via `drizzle-kit generate`.
3. **Add a typed mint helper** in `src/lib/typeid.ts`: `mintProgramId()` etc. Implementation: `typeid('prog').toUUID()`.
4. **Add typed encode/decode helpers** in the same module: `encodeProgramId(uuid)` and `parseProgramId(string): string | null`. The decode helper replaces ad-hoc UUID regex checks at route entry.
5. **Internal logic stays UUID-shaped.** Drizzle queries, joins, business helpers all see and pass raw UUIDs. The TypeID string lives at the seam: response bodies on the way out, path/query params on the way in.
6. **Tests** use the mint helpers for any ID that represents a row in a TypeID-enabled table. IDs that stand in for Supabase users (today: `profiles.id`) keep using `randomUUID()`.

For tables we *don't* TypeID (anything keyed on Supabase auth, or anything we decide isn't worth the boundary work yet): no change. The "untyped UUID = user" convention covers the most common case.

### Common module shape

`src/lib/typeid.ts` ends up with one of these triples per registered prefix:

```ts
export const mintXxxId = () => typeid("xxx").toUUID();
export const encodeXxxId = (uuid: string) => TypeID.fromUUID("xxx", uuid).toString();
export const parseXxxId = (s: string): string | null => { /* … */ };
```

Plus a re-export of the `TypeID` type from `typeid-js` so consumers have one import path. Keeping all prefix definitions in one file makes the registry of types-we-have visible at a glance and prevents two callers from collapsing on a prefix string typo.

## Open questions for the future

- **Do branded types pull their weight?** Re-ask if/when we hit a wrong-ID-to-wrong-route bug, or when the API surface grows past ~20 ID-bearing endpoints.
- **What about Supabase's `auth.users.id`?** Postgres 18 is expected to ship native `uuidv7()`. If/when Supabase exposes that as the default for `auth.users.id`, the calculus on TypeID-encoding `profile.id` flips — it becomes spec-compliant and worth doing for uniformity. Until then, status quo.
- **Do we want server-side enforcement that prefix matches table?** A small dev-only assertion in `parseXxxId` (or a Drizzle middleware) could catch "encoded as `prog` but used to query `invites`" mistakes. Probably overkill until we have ≥5 TypeID-enabled tables.
- **Logging/Sentry encoding.** If we adopt TypeID, error messages and Sentry breadcrumbs that include UUIDs should get encoded too — otherwise the debug benefit only lands at the API edge. Worth a small pass through logging call sites once the seam helpers exist.
