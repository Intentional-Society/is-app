import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { createInvite } from "@/server/invites";
import { inviteHints, invites, profiles, relations } from "@/server/schema";

const expectConstraintViolation = async (promise: Promise<unknown>, expected: string) => {
  try {
    await promise;
  } catch (err) {
    const cause = (err as { cause?: { constraint_name?: string } }).cause;
    expect(cause?.constraint_name).toBe(expected);
    return;
  }
  throw new Error(`expected ${expected} violation but query succeeded`);
};

const insertUserAndProfile = async (id: string) => {
  await db.execute(
    sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${`${id}@testfake.local`}, false, false)`,
  );
  await db.insert(profiles).values({ id });
};

const deleteUserAndProfile = async (id: string) => {
  await db.delete(invites).where(eq(invites.createdBy, id));
  await db.delete(profiles).where(eq(profiles.id, id));
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
};

describe("relations table constraints", () => {
  let raterId: string;
  let rateeId: string;

  beforeEach(async () => {
    raterId = randomUUID();
    rateeId = randomUUID();
    await insertUserAndProfile(raterId);
    await insertUserAndProfile(rateeId);
  });

  afterEach(async () => {
    await db.delete(relations).where(eq(relations.raterId, raterId));
    await db.delete(relations).where(eq(relations.raterId, rateeId));
    await deleteUserAndProfile(raterId);
    await deleteUserAndProfile(rateeId);
  });

  it("accepts a confirmed rating in the 1..4 range", async () => {
    await db.insert(relations).values({ raterId, rateeId, value: 3 });
    const [row] = await db.select().from(relations).where(eq(relations.raterId, raterId));
    expect(row.value).toBe(3);
    expect(row.isHint).toBe(false);
  });

  it("accepts each of 1, 2, 3, 4 as a value", async () => {
    for (const value of [1, 2, 3, 4]) {
      const otherRatee = randomUUID();
      await insertUserAndProfile(otherRatee);
      try {
        await db.insert(relations).values({ raterId, rateeId: otherRatee, value });
      } finally {
        await db.delete(relations).where(eq(relations.rateeId, otherRatee));
        await deleteUserAndProfile(otherRatee);
      }
    }
  });

  it("rejects value 0 (relations_value_range)", async () => {
    await expectConstraintViolation(
      db.insert(relations).values({ raterId, rateeId, value: 0 }),
      "relations_value_range",
    );
  });

  it("rejects value 5 (relations_value_range)", async () => {
    await expectConstraintViolation(
      db.insert(relations).values({ raterId, rateeId, value: 5 }),
      "relations_value_range",
    );
  });

  it("accepts a pending hint (value NULL, isHint true)", async () => {
    await db.insert(relations).values({
      raterId,
      rateeId,
      value: null,
      isHint: true,
      hintedBy: rateeId,
    });
    const [row] = await db.select().from(relations).where(eq(relations.raterId, raterId));
    expect(row.value).toBeNull();
    expect(row.isHint).toBe(true);
    expect(row.hintedBy).toBe(rateeId);
  });

  it("rejects mixed state: value set with isHint true (relations_hint_state)", async () => {
    await expectConstraintViolation(
      db.insert(relations).values({
        raterId,
        rateeId,
        value: 2,
        isHint: true,
      }),
      "relations_hint_state",
    );
  });

  it("rejects mixed state: value NULL with isHint false (relations_hint_state)", async () => {
    await expectConstraintViolation(
      db.insert(relations).values({
        raterId,
        rateeId,
        value: null,
        isHint: false,
      }),
      "relations_hint_state",
    );
  });

  it("rejects rater == ratee (relations_no_self)", async () => {
    await expectConstraintViolation(
      db.insert(relations).values({ raterId, rateeId: raterId, value: 3 }),
      "relations_no_self",
    );
  });

  it("rejects duplicate (rater, ratee) pair (composite PK)", async () => {
    await db.insert(relations).values({ raterId, rateeId, value: 3 });
    await expect(db.insert(relations).values({ raterId, rateeId, value: 4 })).rejects.toThrow();
  });

  it("permits the reverse direction as a separate row", async () => {
    await db.insert(relations).values({ raterId, rateeId, value: 3 });
    await db.insert(relations).values({ raterId: rateeId, rateeId: raterId, value: 2 });
    const rows = await db.select().from(relations);
    const pairs = rows
      .filter(
        (r) => (r.raterId === raterId && r.rateeId === rateeId) || (r.raterId === rateeId && r.rateeId === raterId),
      )
      .map((r) => ({ raterId: r.raterId, rateeId: r.rateeId, value: r.value }));
    expect(pairs).toHaveLength(2);
  });
});

describe("invites.creator_value range", () => {
  let creatorId: string;

  beforeEach(async () => {
    creatorId = randomUUID();
    await insertUserAndProfile(creatorId);
  });

  afterEach(async () => {
    await deleteUserAndProfile(creatorId);
  });

  it("accepts NULL", async () => {
    const r = await createInvite({
      createdBy: creatorId,
      note: "creator value null is fine",
    });
    if ("error" in r) throw new Error("seed failed");
    const [row] = await db.select({ creatorValue: invites.creatorValue }).from(invites).where(eq(invites.code, r.code));
    expect(row.creatorValue).toBeNull();
  });

  it("accepts each of 1, 2, 3, 4", async () => {
    for (const value of [1, 2, 3, 4]) {
      const r = await createInvite({
        createdBy: creatorId,
        note: `creator value ${value} accepted`,
      });
      if ("error" in r) throw new Error("seed failed");
      await db.update(invites).set({ creatorValue: value }).where(eq(invites.code, r.code));
    }
  });

  it("rejects 0 (invites_creator_value_range)", async () => {
    const r = await createInvite({
      createdBy: creatorId,
      note: "creator value 0 should be rejected",
    });
    if ("error" in r) throw new Error("seed failed");
    await expectConstraintViolation(
      db.update(invites).set({ creatorValue: 0 }).where(eq(invites.code, r.code)),
      "invites_creator_value_range",
    );
  });

  it("rejects 5 (invites_creator_value_range)", async () => {
    const r = await createInvite({
      createdBy: creatorId,
      note: "creator value 5 should be rejected",
    });
    if ("error" in r) throw new Error("seed failed");
    await expectConstraintViolation(
      db.update(invites).set({ creatorValue: 5 }).where(eq(invites.code, r.code)),
      "invites_creator_value_range",
    );
  });
});

describe("invite_hints table constraints", () => {
  let creatorId: string;
  let rateeId: string;
  let inviteId: string;

  beforeEach(async () => {
    creatorId = randomUUID();
    rateeId = randomUUID();
    await insertUserAndProfile(creatorId);
    await insertUserAndProfile(rateeId);
    const r = await createInvite({
      createdBy: creatorId,
      note: "invite_hints constraint test invite",
    });
    if ("error" in r) throw new Error("seed failed");
    const [row] = await db.select({ id: invites.id }).from(invites).where(eq(invites.code, r.code));
    inviteId = row.id;
  });

  afterEach(async () => {
    await db.delete(inviteHints).where(eq(inviteHints.inviteId, inviteId));
    await deleteUserAndProfile(creatorId);
    await deleteUserAndProfile(rateeId);
  });

  it("rejects duplicate (invite, ratee) pair (composite PK)", async () => {
    await db.insert(inviteHints).values({ inviteId, rateeId });
    await expect(db.insert(inviteHints).values({ inviteId, rateeId })).rejects.toThrow();
  });

  it("permits the same ratee across different invites", async () => {
    await db.insert(inviteHints).values({ inviteId, rateeId });
    const r2 = await createInvite({
      createdBy: creatorId,
      note: "second invite for cross-invite hint",
    });
    if ("error" in r2) throw new Error("seed failed");
    const [row2] = await db.select({ id: invites.id }).from(invites).where(eq(invites.code, r2.code));
    await db.insert(inviteHints).values({ inviteId: row2.id, rateeId });
  });

  it("cascades to invite_hints when the invite is deleted", async () => {
    await db.insert(inviteHints).values({ inviteId, rateeId });
    await db.delete(invites).where(eq(invites.id, inviteId));
    const remaining = await db.select().from(inviteHints).where(eq(inviteHints.inviteId, inviteId));
    expect(remaining).toHaveLength(0);
  });
});
