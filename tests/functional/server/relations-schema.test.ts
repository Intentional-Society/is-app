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
  let relatorId: string;
  let relateeId: string;

  beforeEach(async () => {
    relatorId = randomUUID();
    relateeId = randomUUID();
    await insertUserAndProfile(relatorId);
    await insertUserAndProfile(relateeId);
  });

  afterEach(async () => {
    await db.delete(relations).where(eq(relations.relatorId, relatorId));
    await db.delete(relations).where(eq(relations.relatorId, relateeId));
    await deleteUserAndProfile(relatorId);
    await deleteUserAndProfile(relateeId);
  });

  it("accepts a confirmed relationship in the 1..4 range", async () => {
    await db.insert(relations).values({ relatorId, relateeId, value: 3 });
    const [row] = await db.select().from(relations).where(eq(relations.relatorId, relatorId));
    expect(row.value).toBe(3);
    expect(row.isHint).toBe(false);
  });

  it("accepts each of 1, 2, 3, 4 as a value", async () => {
    for (const value of [1, 2, 3, 4]) {
      const otherRelatee = randomUUID();
      await insertUserAndProfile(otherRelatee);
      try {
        await db.insert(relations).values({ relatorId, relateeId: otherRelatee, value });
      } finally {
        await db.delete(relations).where(eq(relations.relateeId, otherRelatee));
        await deleteUserAndProfile(otherRelatee);
      }
    }
  });

  it("rejects value 0 (relations_value_range)", async () => {
    await expectConstraintViolation(
      db.insert(relations).values({ relatorId, relateeId, value: 0 }),
      "relations_value_range",
    );
  });

  it("rejects value 5 (relations_value_range)", async () => {
    await expectConstraintViolation(
      db.insert(relations).values({ relatorId, relateeId, value: 5 }),
      "relations_value_range",
    );
  });

  it("accepts a pending hint (value NULL, isHint true)", async () => {
    await db.insert(relations).values({
      relatorId,
      relateeId,
      value: null,
      isHint: true,
      hintedBy: relateeId,
    });
    const [row] = await db.select().from(relations).where(eq(relations.relatorId, relatorId));
    expect(row.value).toBeNull();
    expect(row.isHint).toBe(true);
    expect(row.hintedBy).toBe(relateeId);
  });

  it("rejects mixed state: value set with isHint true (relations_hint_state)", async () => {
    await expectConstraintViolation(
      db.insert(relations).values({
        relatorId,
        relateeId,
        value: 2,
        isHint: true,
      }),
      "relations_hint_state",
    );
  });

  it("rejects mixed state: value NULL with isHint false (relations_hint_state)", async () => {
    await expectConstraintViolation(
      db.insert(relations).values({
        relatorId,
        relateeId,
        value: null,
        isHint: false,
      }),
      "relations_hint_state",
    );
  });

  it("rejects relator == relatee (relations_no_self)", async () => {
    await expectConstraintViolation(
      db.insert(relations).values({ relatorId, relateeId: relatorId, value: 3 }),
      "relations_no_self",
    );
  });

  it("rejects duplicate (relator, relatee) pair (composite PK)", async () => {
    await db.insert(relations).values({ relatorId, relateeId, value: 3 });
    await expect(db.insert(relations).values({ relatorId, relateeId, value: 4 })).rejects.toThrow();
  });

  it("permits the reverse direction as a separate row", async () => {
    await db.insert(relations).values({ relatorId, relateeId, value: 3 });
    await db.insert(relations).values({ relatorId: relateeId, relateeId: relatorId, value: 2 });
    const rows = await db.select().from(relations);
    const pairs = rows
      .filter(
        (r) =>
          (r.relatorId === relatorId && r.relateeId === relateeId) ||
          (r.relatorId === relateeId && r.relateeId === relatorId),
      )
      .map((r) => ({ relatorId: r.relatorId, relateeId: r.relateeId, value: r.value }));
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
    const [row] = await db
      .select({ relationValue: invites.relationValue })
      .from(invites)
      .where(eq(invites.code, r.code));
    expect(row.relationValue).toBeNull();
  });

  it("accepts each of 1, 2, 3, 4", async () => {
    for (const value of [1, 2, 3, 4]) {
      const r = await createInvite({
        createdBy: creatorId,
        note: `creator value ${value} accepted`,
      });
      if ("error" in r) throw new Error("seed failed");
      await db.update(invites).set({ relationValue: value }).where(eq(invites.code, r.code));
    }
  });

  it("rejects 0 (invites_creator_value_range)", async () => {
    const r = await createInvite({
      createdBy: creatorId,
      note: "creator value 0 should be rejected",
    });
    if ("error" in r) throw new Error("seed failed");
    await expectConstraintViolation(
      db.update(invites).set({ relationValue: 0 }).where(eq(invites.code, r.code)),
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
      db.update(invites).set({ relationValue: 5 }).where(eq(invites.code, r.code)),
      "invites_creator_value_range",
    );
  });
});

describe("invite_hints table constraints", () => {
  let creatorId: string;
  let relateeId: string;
  let inviteId: string;

  beforeEach(async () => {
    creatorId = randomUUID();
    relateeId = randomUUID();
    await insertUserAndProfile(creatorId);
    await insertUserAndProfile(relateeId);
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
    await deleteUserAndProfile(relateeId);
  });

  it("rejects duplicate (invite, relatee) pair (composite PK)", async () => {
    await db.insert(inviteHints).values({ inviteId, relateeId });
    await expect(db.insert(inviteHints).values({ inviteId, relateeId })).rejects.toThrow();
  });

  it("permits the same relatee across different invites", async () => {
    await db.insert(inviteHints).values({ inviteId, relateeId });
    const r2 = await createInvite({
      createdBy: creatorId,
      note: "second invite for cross-invite hint",
    });
    if ("error" in r2) throw new Error("seed failed");
    const [row2] = await db.select({ id: invites.id }).from(invites).where(eq(invites.code, r2.code));
    await db.insert(inviteHints).values({ inviteId: row2.id, relateeId });
  });

  it("cascades to invite_hints when the invite is deleted", async () => {
    await db.insert(inviteHints).values({ inviteId, relateeId });
    await db.delete(invites).where(eq(invites.id, inviteId));
    const remaining = await db.select().from(inviteHints).where(eq(inviteHints.inviteId, inviteId));
    expect(remaining).toHaveLength(0);
  });
});
