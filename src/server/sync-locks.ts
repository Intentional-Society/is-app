// Lease-based concurrency lock for sync jobs.
//
// See the "Concurrency lock" section of docs/design-buttondown.md.
// One row in `sync_locks` per actively held lock; the row is deleted
// on release so the table is empty when nothing is running. The lease
// bounds the worst case where a process dies without releasing — the
// next attempt after `lockedUntil` passes takes over.
//
// We use a lease table rather than PostgreSQL session-level advisory
// locks because Supabase's transaction pooler doesn't preserve session
// identity across pool members (see docs/strategy-db-transactions.md).

import { and, eq, sql } from "drizzle-orm";

import { db } from "./db";
import { syncLocks } from "./schema";

const DEFAULT_LEASE_MS = 10 * 60 * 1000;

/**
 * Try to acquire the named lock for the caller. Returns true if the
 * caller now holds it, false if it's held by someone else and still
 * within the lease. Idempotent: re-acquiring an expired lock from the
 * same `acquiredBy` is fine; re-acquiring a still-valid lock from any
 * caller returns false.
 */
export const acquireLock = async (
  name: string,
  acquiredBy: string,
  leaseMs: number = DEFAULT_LEASE_MS,
): Promise<boolean> => {
  const result = await db
    .insert(syncLocks)
    .values({
      name,
      acquiredBy,
      // Postgres `now() + interval '$leaseMs milliseconds'` style; we
      // build it as a typed-driver-side computed timestamp so the
      // lease is anchored in DB clock time, not Node clock time.
      lockedUntil: sql`now() + (${leaseMs}::bigint / 1000.0) * interval '1 second'`,
    })
    .onConflictDoUpdate({
      target: syncLocks.name,
      set: {
        acquiredBy: sql`excluded.acquired_by`,
        lockedUntil: sql`excluded.locked_until`,
      },
      // Only steal an existing lock if it has expired. The setWhere
      // matters: if the existing row's lockedUntil is still in the
      // future, the conflict resolves to DO NOTHING and RETURNING
      // comes back empty.
      setWhere: sql`${syncLocks.lockedUntil} < now()`,
    })
    .returning({ name: syncLocks.name });

  return result.length > 0;
};

/**
 * Release the named lock if held by the caller. Deletes the row.
 * Safe to call when no lock exists or when the lock is held by
 * someone else — only rows matching both `name` and `acquiredBy` are
 * removed, so a stale process waking up after its lease expired
 * can't accidentally delete a fresher run's lock.
 */
export const releaseLock = async (name: string, acquiredBy: string): Promise<void> => {
  await db.delete(syncLocks).where(and(eq(syncLocks.name, name), eq(syncLocks.acquiredBy, acquiredBy)));
};
