# Robust Database Transactions

Guidance for writing database transactions that survive the Supabase connection
pooler. **Read this before adding any `db.transaction(...)` call.**

## TL;DR — the rule

The default `db` client (`src/server/db.ts`) connects through the Supabase
**transaction pooler**. In May 2026 we observed a multi-statement
`BEGIN…COMMIT` over that pooler being **silently mishandled**: writes
disappearing with no error while the transaction still reported success, and
the loud sibling — aborting part-way through with `25P02`. The anomaly has not
reproduced since and its mechanism was never confirmed, but the failure mode is
silent data loss and the safe patterns below are cheap — so we treat the
combination as unsafe **by policy**, not because the bug is known to still
exist.

So:

- A **single autocommit statement** is always safe — `db.insert(...)`,
  `db.update(...)`, `db.delete(...)` on their own. Use these freely.
- A **multi-statement `db.transaction(...)`** on the default `db` client is
  **not safe**. Avoid it.
- When several writes must land atomically, pick a pattern from
  [Patterns](#patterns), preferred first:
  1. **One statement** — collapse the writes into a single statement (writable CTE).
  2. **Postgres function** — move the logic into the database, call it as one statement.
  3. **`dbTx` client** — run the transaction over the *session* pooler, where
     multi-statement transactions are sound.

If you remember one thing: *the hazard is multi-statement transactions on the
transaction pooler — nothing else.*

## Background — why this doc exists (the #149 investigation)

`#149` was an intermittent e2e failure: Playwright's `waitForURL('/welcome')`
timed out, seemingly at random, for weeks. The investigation ran long and took
several false starts — RSC streaming, the Next.js router, caching, and read
replicas were all chased and ruled out. It resolved into **two separate bugs
sharing one symptom** (a welcome-flow read seeing profile state the e2e reset
had just cleared, so `/` skipped the redirect to `/welcome`):

**Bug 1 — the reset's `db.transaction` intermittently lost its writes**
(May 2026). `resetE2EUsers` wrapped its `DELETE` + `UPDATE` in a
`db.transaction(...)` over the transaction pooler. A diagnostic probe caught
the reset returning **HTTP 200 with a stale `bio`** — the UPDATE's `RETURNING`
reported the row touched, yet the read-back milliseconds later saw the old
value with an `updated_at` older than the reset. Production logs (Axiom) also
showed the *loud* variant: `POST /api/_test/reset` returning 500 with a
Postgres `25P02` ("current transaction is aborted") error. The reset never
needed atomicity, so #173 replaced the transaction with two plain autocommit
statements. The probe's anomaly assertion — still armed in
`tests/e2e/helpers/session.ts` — has been silent across thousands of resets
since 2026-05-16.

**Bug 2 — concurrent e2e runs clobbering each other** (every remaining #149
failure, May–June 2026). The suite drives two fixed seeded accounts in the
shared prod DB, and `e2e.yml` had no concurrency control — so two deploys
minutes apart ran two suites at once, and one run's reset/welcome writes landed
mid-test in the other. Retro-analysis showed every #149-signature failure on a
trusted branch after #173 coincided with an overlapping run. This mechanism
produced the "impossible" traces (a write visible to one read, gone from the
next) that were chased as pooler stale-read anomalies — the database behaved
correctly the whole time; the unmodeled writer was the other CI run. Fixed by
#358: a global concurrency group in `e2e.yml` serializes e2e runs.

Bug 1 is why this doc exists: the same `db.transaction`-over-the-pooler hazard
applies to *real* application transactions, so those are written safely by
construction.

## The mechanism

### Supavisor, and what "transaction mode" means

Supabase fronts Postgres with **Supavisor**, a connection pooler. Supavisor has
two pooling **modes**, selected by the port you connect to:

- **Transaction mode** — port `6543`. A backend Postgres connection is lent to a
  client only for the duration of one transaction, then returned to a shared
  pool. Many clients share few backends. This is what `DATABASE_URL` points at.
- **Session mode** — port `5432` on the pooler host. A backend is dedicated to a
  client for its entire connection lifetime.

"Transaction mode" is a property of the *pooler endpoint*, not of your app
issuing a SQL transaction — but the two are linked: in transaction mode, a SQL
transaction (`BEGIN…COMMIT`) is the unit Supavisor pins a backend around. It
watches the wire for `BEGIN` and `COMMIT` to know when to pin and release.

### How a multi-statement transaction gets mishandled

To run `BEGIN; stmt; stmt; COMMIT` correctly, transaction mode must pin **one**
backend for the whole sequence. When that pinning desyncs — statements routed to
different backends, or the `COMMIT` not reaching the backend that holds the
writes — the transaction is mishandled. The desync itself is our working model,
never confirmed from traces (see
[What we are and aren't sure of](#what-we-are-and-arent-sure-of)); the two
result shapes below were observed directly:

- **Silent discard** — the transaction appears to commit (no error; `RETURNING`
  even returns row data), but the writes were never persisted.
- **Loud abort** — a later statement hits `25P02` *"current transaction is
  aborted, commands ignored until end of transaction block"*, because the
  transaction was aborted before that statement ran.

A **single statement** has no `BEGIN…COMMIT` for the pooler to mishandle. The
pooler routes the whole statement to one backend; Postgres runs it as its own
implicit transaction, atomically. Single statements are immune.

### What we are and aren't sure of

- **Sure:** `resetE2EUsers`' `db.transaction` intermittently failed to persist
  (probe-observed: HTTP 200 + stale data) and intermittently aborted with
  `25P02` (Axiom-observed). Dropping the transaction fixed it: the read-back
  assertion has stayed silent since 2026-05-16.
- **Sure:** every `#149`-signature failure *after* the transaction was dropped
  was cross-run clobbering (#358), fixed by serializing e2e runs — those
  failures say nothing about the pooler.
- **Working model, not proven:** the precise trigger — the *first* error that
  aborted the transaction — was never captured in logs. The backend-split
  explanation above is the most coherent fit but is not confirmed from our own
  traces. The direct evidence is the mid-May 2026 probe captures; the anomaly
  never reproduced after #173, and Supavisor is a managed component that
  changes underneath us, so whether the hazard still exists today is unknown.
- **Related, not identical:** [supabase/supabase#43753](https://github.com/supabase/supabase/issues/43753)
  reports transaction-pooler transactions silently discarding writes. It is
  filed for `SERIALIZABLE` isolation and is untriaged; our transactions run
  `READ COMMITTED`. A strong sibling, not a verified root-cause match.

The uncertainty about the exact trigger does not change the guidance: the
patterns below are safe *by construction*, whatever the precise pooler bug.

## Why we use the transaction pooler at all

Two reasons, doing different jobs (see `devjournal.md`, 2026-04-04):

- **IPv4** — Supabase's *direct* database connection is IPv6-only; Vercel
  functions cannot reliably reach it. This forces us off the direct connection
  onto *a pooler*. Both pooler modes provide IPv4, so this alone does not
  dictate the mode.
- **Serverless** — Vercel functions are transient. A connection is held for the
  lifetime of the (Fluid Compute) function *instance* — minutes, across many
  requests — not per request. In *session* mode each held connection pins a
  backend for that whole lifetime; a swarm of warm instances would exhaust
  Postgres's connection limit. *Transaction* mode avoids this by consuming a
  backend only per-transaction (milliseconds).

So: IPv4 forces a pooler; serverless makes it the *transaction* pooler. The
session pooler stays available (and IPv4) for the narrow set of operations that
need real transactions — see the `dbTx` pattern.

## Failure modes to recognize

| Mode | What you see | Where |
|---|---|---|
| Silent discard | Operation "succeeds" (HTTP 2xx, `RETURNING` data), rows aren't in the DB | No error anywhere — only detectable by reading data back |
| Loud abort | Postgres `25P02`, surfaced by the code as a 5xx | App logs / Axiom (`vercel` dataset) |

The silent mode is the dangerous one: every `try/catch` and success-check in the
calling code is defeated, because nothing throws.

## Patterns

Ordered most-preferred first. All are safe by construction.

### 1. One statement — writable CTE (preferred)

If the writes can be expressed as a single statement, they cannot be split.
Postgres data-modifying CTEs let one statement perform several writes:

```sql
WITH new_invite AS (
  INSERT INTO invites (code, created_by, note, expires_at, creator_value)
  VALUES ($1, $2, $3, now() + interval '...', $4)
  RETURNING id, code, note, expires_at, creator_value
), inserted_hints AS (
  INSERT INTO invite_hints (invite_id, ratee_id)
  SELECT new_invite.id, h FROM new_invite, unnest($5::uuid[]) AS h
  RETURNING 1
)
SELECT * FROM new_invite;
```

All data-modifying CTEs execute even when the final query does not reference
them, so `inserted_hints` runs. The whole thing is one statement → one backend →
atomic. It stays on the transaction pooler and needs no extra connection.

In Drizzle, express this with `db.execute(sql\`...\`)` or the CTE builder. Use
this whenever the logic has no branching.

### Raw `db.execute` gotchas

Patterns 1 and 2 run raw SQL via `db.execute`. Raw execution skips the typed
query builder, so two of its conveniences are gone — both bit the `createInvite`
rewrite:

- **A JS array interpolated into a `sql` template is spread as a
  comma-separated list** — handy for `IN (...)`, wrong for anything that expects
  a single array value (`unnest`, `= ANY(...)`). An empty array renders as
  nothing, producing invalid SQL. Build the array explicitly:

  ```ts
  unnest(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[])
  ```

  That yields `ARRAY[$1, $2]::uuid[]`, or a valid `ARRAY[]::uuid[]` when empty.

- **Column types are not mapped.** The typed query builder converts a
  `timestamptz` column to a JS `Date`; raw `db.execute` returns what the driver
  hands back — for `timestamptz`, a string. Convert at the call site
  (`new Date(row.ts)`), or cast in SQL so the shape is predictable.

### 2. Postgres function (for logic a CTE can't express)

When the transaction needs conditional logic — "if this UPDATE matched 0 rows,
roll everything back" — a single SQL statement can't express it, but a `plpgsql`
function can. The function runs server-side as one atomic unit; the app calls it
as **one statement**:

```sql
CREATE FUNCTION redeem_invite(p_user uuid, p_code text, ...) RETURNS ...
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO profiles ...;
  UPDATE invites SET redeemed_by = p_user, ... WHERE code = p_code AND ...;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_invalid';   -- rolls the function back
  END IF;
  ...
  RETURN ...;
END $$;
```

```ts
await db.execute(sql`SELECT * FROM redeem_invite(${userId}, ${code}, ...)`);
```

The function body's `BEGIN…END` is plpgsql block structure, executed atomically
inside the single `SELECT` — the pooler sees one statement. Cost: the logic
lives in a migration rather than TypeScript.

### 3. The `dbTx` client — session pooler (when logic must stay in TS)

**Status: design, not yet wired.** Nothing in `src/` defines `dbTx` or
`SESSION_DATABASE_URL` today — implement the client below and add the env var
(Vercel + `.env.local`) before first use.

When neither of the above fits and the logic must stay in TypeScript with
`db.transaction(...)`, run it over a **second client pointed at the session
pooler**, where multi-statement transactions are sound:

```ts
// src/server/db.ts
const txClient = postgres(process.env.SESSION_DATABASE_URL!, {
  max: 1,            // bound the backends held per process
  idle_timeout: 20,  // release the backend ~20s after the last transaction
});
export const dbTx = drizzle(txClient);
```

Then `dbTx.transaction(async (tx) => { ... })` gives full, unmediated Postgres
transaction semantics.

Caveats — important:

- This needs a `SESSION_DATABASE_URL` env var: the pooler host on port **5432**
  (`DATABASE_URL` is the `:6543` one).
- Session mode pins a backend per connection. `max: 1` plus a short
  `idle_timeout` keeps a process from holding more than one backend and releases
  it shortly after use — so steady-state backend use tracks *recent transaction
  activity*, not the number of warm function instances.
- This is bounded-by-traffic, not bounded-by-design. It is fine at this app's
  scale; if a transactional path ever becomes high-traffic, move it to pattern
  1 or 2.

### Anti-pattern

```ts
// DO NOT: multi-statement transaction on the transaction-pooler client
await db.transaction(async (tx) => {
  await tx.insert(...);
  await tx.update(...);
});
```

This is the bug that hit `resetE2EUsers` (#149, bug 1). A single
`await db.insert(...)` is fine; the `transaction` wrapper around multiple
statements is not.

## Connection options reference

| | Direct | Session pooler | Transaction pooler |
|---|---|---|---|
| Host / port | DB host : 5432 | pooler host : 5432 | pooler host : 6543 |
| IPv4 | ❌ IPv6-only | ✅ | ✅ |
| Backend held for | the connection | the connection | one transaction |
| Serverless-safe | ❌ exhausts connections | ⚠️ only with small `max` + `idle_timeout` | ✅ |
| Multi-statement txns | ✅ sound | ✅ sound | ⚠️ can be mishandled |
| Prepared statements | ✅ | ✅ | ⚠️ partial (Supavisor-emulated) |
| In this app | unused | pattern 3 (design — not yet wired) | `db` (`DATABASE_URL`) |

postgres-js options worth knowing: `max` (pool size), `idle_timeout` (close idle
connections — the key to bounding session-mode backends), `prepare` (defaults
true; harmless on the transaction pooler in practice — Supavisor emulates
prepared-statement support). The default `db` client sets `prepare: false`,
adopted mid-investigation as a #149 isolation experiment (#296). The A/B
answered "not a factor": the failure signature continued unchanged until #358's
concurrency fix. It stays because it costs nothing and reverting would
re-introduce a variable — see the comment in `db.ts`.

## Recognizing this in the wild

- A write that "succeeded" but isn't in the DB, with no error → suspect silent
  discard. Confirm by reading the row back.
- A `25P02` error, or a 5xx on a path that runs a `db.transaction` → loud abort.
- Logs are in Axiom, `vercel` dataset (Vercel log drain). Filter by the request
  id; note the *root* error may be a separate, earlier line — and may not be
  logged at all if it happened pooler-side.

## Current transaction inventory

Keep this current as transactions are added or changed.

| Site | Status |
|---|---|
| `resetE2EUsers` (`src/server/test-reset.ts`) | Fixed — `db.transaction` dropped; two autocommit statements (it never needed atomicity). |
| `createInvite` (`src/server/invites.ts`) | Hardened — pattern 1 (writable CTE): invite + hint rows written in one statement, no transaction. |
| invited sign-in (`src/app/auth/callback/route.ts`) | Accepted risk, alarmed (decision 2026-07-02) — multi-statement txn (profile insert + invite redemption + relations) kept as-is. Monitoring covers both failure shapes: loud aborts hit `Sentry_captureException` (tags `feature:auth-callback`) plus an Axiom `invite redemption failed` line with `pgCode`; silent discard is caught by a post-commit read-back of the invite's `redeemed_by`, which raises a Sentry error on mismatch. A 2026-06 audit found zero anomalies across all 22 prod redemptions. Pattern 2 (a `redeem_invite` function) is the harden path if the alarm ever fires. |

## References

- Issue `#149` — the full investigation trail (closing comment has the
  two-bug retro-analysis).
- Issue `#358` — the cross-run clobber mechanism and the e2e concurrency fix.
- [supabase/supabase#43753](https://github.com/supabase/supabase/issues/43753)
  — transaction pooler silently discards writes.
- [Supabase: disabling prepared statements](https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL).
- `devjournal.md`, 2026-04-04 — why `DATABASE_URL` uses the transaction pooler.
