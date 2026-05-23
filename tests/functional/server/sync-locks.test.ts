import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { syncLocks } from "@/server/schema";
import { acquireLock, releaseLock } from "@/server/sync-locks";

const LOCK_NAME = "test-lock-buttondown";

describe("sync-locks", () => {
  beforeEach(async () => {
    await db.delete(syncLocks);
  });

  afterEach(async () => {
    await db.delete(syncLocks);
  });

  it("acquires when no lock exists", async () => {
    const ok = await acquireLock(LOCK_NAME, "caller-a");
    expect(ok).toBe(true);

    const rows = await db.select().from(syncLocks);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: LOCK_NAME, acquiredBy: "caller-a" });
  });

  it("refuses a second acquire while the lease is still valid", async () => {
    expect(await acquireLock(LOCK_NAME, "caller-a")).toBe(true);
    expect(await acquireLock(LOCK_NAME, "caller-b")).toBe(false);

    const rows = await db.select().from(syncLocks);
    expect(rows[0].acquiredBy).toBe("caller-a");
  });

  it("refuses re-acquire from the same caller while the lease is valid", async () => {
    expect(await acquireLock(LOCK_NAME, "caller-a")).toBe(true);
    // Same caller, still within lease — the WHERE expired clause
    // protects against double-acquire regardless of caller identity.
    expect(await acquireLock(LOCK_NAME, "caller-a")).toBe(false);
  });

  it("acquires when the existing lock has expired (lease=0 forces immediate expiry)", async () => {
    // 0ms lease — the just-acquired row is already expired by the
    // time the next acquire attempts to read it.
    expect(await acquireLock(LOCK_NAME, "caller-a", 0)).toBe(true);
    expect(await acquireLock(LOCK_NAME, "caller-b")).toBe(true);

    const rows = await db.select().from(syncLocks);
    expect(rows[0].acquiredBy).toBe("caller-b");
  });

  it("releases a held lock", async () => {
    await acquireLock(LOCK_NAME, "caller-a");
    await releaseLock(LOCK_NAME, "caller-a");

    const rows = await db.select().from(syncLocks);
    expect(rows).toHaveLength(0);
  });

  it("does not release when the acquired_by doesn't match", async () => {
    await acquireLock(LOCK_NAME, "caller-a");
    await releaseLock(LOCK_NAME, "caller-b");

    const rows = await db.select().from(syncLocks);
    expect(rows).toHaveLength(1);
    expect(rows[0].acquiredBy).toBe("caller-a");
  });

  it("is idempotent when no lock exists", async () => {
    // Releasing nothing is fine — useful for finally-blocks.
    await expect(releaseLock(LOCK_NAME, "caller-a")).resolves.toBeUndefined();
  });
});
