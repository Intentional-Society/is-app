import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import app from "@/server/api";
import { db } from "@/server/db";
import { createInvite } from "@/server/invites";
import {
  deleteRelationValue,
  getRelationSuggestions,
  getRelationValue,
  materializeInviteRelations,
  updateRelationValue,
} from "@/server/relations";
import { inviteHints, invites, profiles, relations } from "@/server/schema";

import { authAs, deleteUserAndProfile, insertUserAndProfile, resetAuth } from "./relation-helpers";

describe("updateRelationValue", () => {
  let relatorId: string;
  let relateeId: string;

  beforeEach(async () => {
    relatorId = randomUUID();
    relateeId = randomUUID();
    await insertUserAndProfile(relatorId);
    await insertUserAndProfile(relateeId);
  });

  afterEach(async () => {
    await deleteUserAndProfile(relatorId);
    await deleteUserAndProfile(relateeId);
  });

  it("creates a confirmed relationship row", async () => {
    const r = await updateRelationValue({ relatorId, relateeId, value: 3 });
    expect(r).toEqual({ ok: true });

    const [row] = await db.select().from(relations).where(eq(relations.relatorId, relatorId));
    expect(row.value).toBe(3);
    expect(row.isHint).toBe(false);
  });

  it("updating an existing relationship changes value and bumps updatedAt without changing the primary key", async () => {
    await updateRelationValue({ relatorId, relateeId, value: 2 });
    const [first] = await db.select().from(relations).where(eq(relations.relatorId, relatorId));

    await new Promise((r) => setTimeout(r, 10));
    await updateRelationValue({ relatorId, relateeId, value: 4 });

    const rows = await db.select().from(relations).where(eq(relations.relatorId, relatorId));
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(4);
    expect(rows[0].updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
  });

  it("flips isHint to false on confirmation while preserving hintedBy", async () => {
    const hinterId = randomUUID();
    await insertUserAndProfile(hinterId);
    try {
      await db.insert(relations).values({
        relatorId,
        relateeId,
        value: null,
        isHint: true,
        hintedBy: hinterId,
      });

      const r = await updateRelationValue({ relatorId, relateeId, value: 2 });
      expect(r).toEqual({ ok: true });

      const [row] = await db.select().from(relations).where(eq(relations.relatorId, relatorId));
      expect(row.value).toBe(2);
      expect(row.isHint).toBe(false);
      expect(row.hintedBy).toBe(hinterId);
    } finally {
      await deleteUserAndProfile(hinterId);
    }
  });

  it("rejects self-relating before hitting the DB constraint", async () => {
    const r = await updateRelationValue({ relatorId, relateeId: relatorId, value: 3 });
    expect(r).toEqual({ error: "self_relating" });
  });

  it("rejects relating to a non-existent ratee", async () => {
    const r = await updateRelationValue({ relatorId, relateeId: randomUUID(), value: 3 });
    expect(r).toEqual({ error: "relatee_not_found" });
  });
});

describe("getRelationValue", () => {
  let relatorId: string;
  let relateeId: string;

  beforeEach(async () => {
    relatorId = randomUUID();
    relateeId = randomUUID();
    await insertUserAndProfile(relatorId);
    await insertUserAndProfile(relateeId);
  });

  afterEach(async () => {
    await deleteUserAndProfile(relatorId);
    await deleteUserAndProfile(relateeId);
  });

  it("returns the value of a confirmed relation", async () => {
    await updateRelationValue({ relatorId, relateeId, value: 3 });
    expect(await getRelationValue({ relatorId, relateeId })).toBe(3);
  });

  it("returns null when no relation exists", async () => {
    expect(await getRelationValue({ relatorId, relateeId })).toBeNull();
  });

  it("is directional — does not read the reverse edge", async () => {
    await updateRelationValue({ relatorId: relateeId, relateeId: relatorId, value: 4 });
    expect(await getRelationValue({ relatorId, relateeId })).toBeNull();
  });

  it("ignores hint rows (value-less, isHint=true)", async () => {
    await db.insert(relations).values({ relatorId, relateeId, value: null, isHint: true, hintedBy: relateeId });
    expect(await getRelationValue({ relatorId, relateeId })).toBeNull();
  });
});

describe("deleteRelationValue", () => {
  let relatorId: string;
  let relateeId: string;

  beforeEach(async () => {
    relatorId = randomUUID();
    relateeId = randomUUID();
    await insertUserAndProfile(relatorId);
    await insertUserAndProfile(relateeId);
  });

  afterEach(async () => {
    await deleteUserAndProfile(relatorId);
    await deleteUserAndProfile(relateeId);
  });

  it("removes a confirmed relationship", async () => {
    await updateRelationValue({ relatorId, relateeId, value: 3 });

    const r = await deleteRelationValue({ relatorId, relateeId });
    expect(r).toEqual({ ok: true, deleted: true });

    const rows = await db.select().from(relations).where(eq(relations.relatorId, relatorId));
    expect(rows).toHaveLength(0);
  });

  it("is idempotent — deleting an absent relation reports deleted=false, not an error", async () => {
    expect(await deleteRelationValue({ relatorId, relateeId })).toEqual({ ok: true, deleted: false });
  });

  it("leaves a pending hint untouched (scoped to isHint=false)", async () => {
    await db.insert(relations).values({ relatorId, relateeId, value: null, isHint: true, hintedBy: relateeId });

    expect(await deleteRelationValue({ relatorId, relateeId })).toEqual({ ok: true, deleted: false });

    const [row] = await db.select().from(relations).where(eq(relations.relatorId, relatorId));
    expect(row.isHint).toBe(true);
  });

  it("is directional — does not delete the reverse edge", async () => {
    await updateRelationValue({ relatorId: relateeId, relateeId: relatorId, value: 4 });

    expect(await deleteRelationValue({ relatorId, relateeId })).toEqual({ ok: true, deleted: false });

    const rows = await db.select().from(relations).where(eq(relations.relatorId, relateeId));
    expect(rows).toHaveLength(1);
  });
});

describe("getRelationSuggestions", () => {
  let me: string;

  beforeEach(async () => {
    me = randomUUID();
    await insertUserAndProfile(me, { displayName: "Me" });
  });

  afterEach(async () => {
    await deleteUserAndProfile(me);
  });

  // Assertions in this block scope to the test's own UUIDs rather than
  // array lengths — the dev DB may carry seeded profiles (e2e admin,
  // Welcome Tester) from local e2e runs, and those legitimately surface
  // through sources 4 and 5. Length-based asserts would couple the
  // tests to DB-cleanliness instead of the source logic under test.
  it("a fresh user gets no person-targeted signals (sources 1–3) of their own", async () => {
    const feed = await getRelationSuggestions(me);
    const personSignals = feed.suggestions.filter((c) => ["addedYou", "hint", "viaInviter"].includes(c.reason.type));
    expect(personSignals).toEqual([]);
  });

  it("source 1 — surfaces people who rated me, without their value (soft-hide)", async () => {
    const them = randomUUID();
    await insertUserAndProfile(them, { displayName: "Them" });
    try {
      await updateRelationValue({ relatorId: them, relateeId: me, value: 4 });
      const feed = await getRelationSuggestions(me);
      const card = feed.suggestions.find((c) => c.id === them);
      expect(card?.reason).toEqual({ type: "addedYou" });
      // No value field anywhere on the card.
      expect(JSON.stringify(card)).not.toContain('"value"');
    } finally {
      await deleteUserAndProfile(them);
    }
  });

  it("source 1 — excludes anyone I've already rated", async () => {
    const them = randomUUID();
    await insertUserAndProfile(them, { displayName: "Them" });
    try {
      await updateRelationValue({ relatorId: them, relateeId: me, value: 3 });
      await updateRelationValue({ relatorId: me, relateeId: them, value: 2 });
      const feed = await getRelationSuggestions(me);
      const allCards = [...feed.suggestions, ...feed.otherMembers];
      expect(allCards.find((c) => c.id === them)).toBeUndefined();
    } finally {
      await deleteUserAndProfile(them);
    }
  });

  it("source 2 — surfaces pending hints with hintedBy attribution", async () => {
    const target = randomUUID();
    const hinter = randomUUID();
    await insertUserAndProfile(target, { displayName: "Target" });
    await insertUserAndProfile(hinter, { displayName: "Hinter" });
    try {
      await db.insert(relations).values({
        relatorId: me,
        relateeId: target,
        value: null,
        isHint: true,
        hintedBy: hinter,
      });
      const feed = await getRelationSuggestions(me);
      const card = feed.suggestions.find((c) => c.id === target);
      expect(card?.reason).toEqual({
        type: "hint",
        hintedBy: { id: hinter, displayName: "Hinter", slug: null },
      });
    } finally {
      await deleteUserAndProfile(hinter);
      await deleteUserAndProfile(target);
    }
  });

  it("source 3 — surfaces my inviter's higher-rated connections via attribution", async () => {
    const inviter = randomUUID();
    const friend = randomUUID();
    const acquaintance = randomUUID();
    await insertUserAndProfile(inviter, { displayName: "Inviter" });
    await insertUserAndProfile(friend, { displayName: "Friend" });
    await insertUserAndProfile(acquaintance, { displayName: "Acquaintance" });
    try {
      await db.update(profiles).set({ referredBy: inviter }).where(eq(profiles.id, me));
      await updateRelationValue({ relatorId: inviter, relateeId: friend, value: 4 });
      await updateRelationValue({ relatorId: inviter, relateeId: acquaintance, value: 2 });

      const feed = await getRelationSuggestions(me);
      const friendCard = feed.suggestions.find((c) => c.id === friend);
      expect(friendCard?.reason).toEqual({
        type: "viaInviter",
        inviter: { id: inviter, displayName: "Inviter", slug: null },
      });
      // Acquaintance (value < 3) doesn't qualify for source 3, so they
      // fall through to source 5 ("everybody else") and land in
      // otherMembers with the catch-all `member` reason.
      const acquaintanceCard = feed.otherMembers.find((c) => c.id === acquaintance);
      expect(acquaintanceCard?.reason).toEqual({ type: "member" });
    } finally {
      await deleteUserAndProfile(friend);
      await deleteUserAndProfile(acquaintance);
      await deleteUserAndProfile(inviter);
    }
  });

  it("source 4 — surfaces members with last_updated_web more recent than mine", async () => {
    const recent = randomUUID();
    const stale = randomUUID();
    await insertUserAndProfile(recent, { displayName: "Recent" });
    await insertUserAndProfile(stale, { displayName: "Stale" });
    try {
      await db.update(profiles).set({ lastUpdatedWeb: sql`now() - interval '1 day'` }).where(eq(profiles.id, me));
      await db.update(profiles).set({ lastUpdatedWeb: sql`now()` }).where(eq(profiles.id, recent));
      await db.update(profiles).set({ lastUpdatedWeb: sql`now() - interval '7 days'` }).where(eq(profiles.id, stale));

      const feed = await getRelationSuggestions(me);
      const recentCard = feed.suggestions.find((c) => c.id === recent);
      expect(recentCard?.reason).toEqual({ type: "recentlyActive" });
      // Stale (older than mine) falls through to source 5 and lands in
      // otherMembers as a plain `member` card.
      const staleCard = feed.otherMembers.find((c) => c.id === stale);
      expect(staleCard?.reason).toEqual({ type: "member" });
    } finally {
      await deleteUserAndProfile(recent);
      await deleteUserAndProfile(stale);
    }
  });

  it("source 5 — everybody else lands in otherMembers as a `member` card", async () => {
    const dormant = randomUUID();
    await insertUserAndProfile(dormant, { displayName: "Dormant" });
    try {
      // No relation, no hint, no inviter, no last_updated_web bump —
      // they only qualify under source 5.
      const feed = await getRelationSuggestions(me);
      expect(feed.suggestions.find((c) => c.id === dormant)).toBeUndefined();
      const card = feed.otherMembers.find((c) => c.id === dormant);
      expect(card?.reason).toEqual({ type: "member" });
    } finally {
      await deleteUserAndProfile(dormant);
    }
  });

  it("a single person never appears twice — highest-priority source wins", async () => {
    const them = randomUUID();
    await insertUserAndProfile(them, { displayName: "Them" });
    try {
      // They rated me (source 1).
      await updateRelationValue({ relatorId: them, relateeId: me, value: 4 });
      // And they're recently active (source 4).
      await db.update(profiles).set({ lastUpdatedWeb: sql`now()` }).where(eq(profiles.id, them));
      await db.update(profiles).set({ lastUpdatedWeb: sql`now() - interval '1 day'` }).where(eq(profiles.id, me));

      const feed = await getRelationSuggestions(me);
      const allCards = [...feed.suggestions, ...feed.otherMembers];
      const occurrences = allCards.filter((c) => c.id === them).length;
      expect(occurrences).toBe(1);
      // Source 1 wins.
      expect(feed.suggestions[0].id).toBe(them);
      expect(feed.suggestions[0].reason).toEqual({ type: "addedYou" });
    } finally {
      await deleteUserAndProfile(them);
    }
  });

  it("excludes self under all sources", async () => {
    await db.update(profiles).set({ lastUpdatedWeb: sql`now()` }).where(eq(profiles.id, me));
    const feed = await getRelationSuggestions(me);
    expect([...feed.suggestions, ...feed.otherMembers].map((c) => c.id)).not.toContain(me);
  });
});

describe("getRelationSuggestions — hidden filter", () => {
  let me: string;
  let visibleOther: string;
  let hiddenOther: string;

  beforeEach(async () => {
    me = randomUUID();
    visibleOther = randomUUID();
    hiddenOther = randomUUID();
    await insertUserAndProfile(me, { displayName: "Me" });
    await insertUserAndProfile(visibleOther, { displayName: "Visible" });
    await insertUserAndProfile(hiddenOther, { displayName: "Hidden" });
    await db.update(profiles).set({ hidden: true }).where(eq(profiles.id, hiddenOther));
  });

  afterEach(async () => {
    await deleteUserAndProfile(me);
    await deleteUserAndProfile(visibleOther);
    await deleteUserAndProfile(hiddenOther);
  });

  it("source 1 — addedYou skips hidden raters", async () => {
    await updateRelationValue({ relatorId: visibleOther, relateeId: me, value: 3 });
    await updateRelationValue({ relatorId: hiddenOther, relateeId: me, value: 4 });
    const feed = await getRelationSuggestions(me);
    const allIds = [...feed.suggestions, ...feed.otherMembers].map((c) => c.id);
    expect(allIds).toContain(visibleOther);
    expect(allIds).not.toContain(hiddenOther);
  });

  it("source 5 — everyoneElse skips hidden profiles", async () => {
    const feed = await getRelationSuggestions(me);
    const allIds = [...feed.suggestions, ...feed.otherMembers].map((c) => c.id);
    expect(allIds).toContain(visibleOther);
    expect(allIds).not.toContain(hiddenOther);
  });
});

describe("materializeInviteRelations", () => {
  let inviter: string;
  let redeemer: string;
  let h1: string;
  let h2: string;

  beforeEach(async () => {
    inviter = randomUUID();
    redeemer = randomUUID();
    h1 = randomUUID();
    h2 = randomUUID();
    await insertUserAndProfile(inviter, { displayName: "Inviter" });
    await insertUserAndProfile(redeemer, { displayName: "Redeemer" });
    await insertUserAndProfile(h1, { displayName: "H1" });
    await insertUserAndProfile(h2, { displayName: "H2" });
  });

  afterEach(async () => {
    await deleteUserAndProfile(inviter);
    await deleteUserAndProfile(redeemer);
    await deleteUserAndProfile(h1);
    await deleteUserAndProfile(h2);
  });

  it("inserts a confirmed inviter→redeemer relationship from creator_value", async () => {
    const r = await createInvite({ createdBy: inviter, note: "creator value materialization" });
    if ("error" in r) throw new Error("seed failed");
    const [row] = await db.select({ id: invites.id }).from(invites).where(eq(invites.code, r.code));

    await materializeInviteRelations(db, {
      inviteId: row.id,
      inviterId: inviter,
      redeemerId: redeemer,
      relationValue: 3,
    });

    const [rel] = await db
      .select()
      .from(relations)
      .where(and(eq(relations.relatorId, inviter), eq(relations.relateeId, redeemer)));
    expect(rel.value).toBe(3);
    expect(rel.isHint).toBe(false);
  });

  it("inserts pending hint rows for each invite_hints row, redeemer→ratee, hintedBy=inviter", async () => {
    const r = await createInvite({
      createdBy: inviter,
      note: "hint materialization happy path",
      hints: [h1, h2],
    });
    if ("error" in r) throw new Error("seed failed");
    expect(r.hintCount).toBe(2);

    const [row] = await db.select({ id: invites.id }).from(invites).where(eq(invites.code, r.code));

    await materializeInviteRelations(db, {
      inviteId: row.id,
      inviterId: inviter,
      redeemerId: redeemer,
      relationValue: null,
    });

    const rels = await db.select().from(relations).where(eq(relations.relatorId, redeemer));
    expect(rels).toHaveLength(2);
    for (const rel of rels) {
      expect(rel.isHint).toBe(true);
      expect(rel.value).toBeNull();
      expect(rel.hintedBy).toBe(inviter);
      expect([h1, h2]).toContain(rel.relateeId);
    }
  });

  it("does nothing when creator_value is null and there are no hints", async () => {
    const r = await createInvite({ createdBy: inviter, note: "no materialization payload" });
    if ("error" in r) throw new Error("seed failed");
    const [row] = await db.select({ id: invites.id }).from(invites).where(eq(invites.code, r.code));

    await materializeInviteRelations(db, {
      inviteId: row.id,
      inviterId: inviter,
      redeemerId: redeemer,
      relationValue: null,
    });

    const rels = await db.select().from(relations).where(eq(relations.relatorId, redeemer));
    expect(rels).toEqual([]);
  });

  it("skips hint rows that point at the redeemer (no relations_no_self violation)", async () => {
    const r = await createInvite({ createdBy: inviter, note: "self-hint defensive skip" });
    if ("error" in r) throw new Error("seed failed");
    const [row] = await db.select({ id: invites.id }).from(invites).where(eq(invites.code, r.code));
    // Bypass the API validator to construct the pathological row.
    await db.insert(inviteHints).values({ inviteId: row.id, relateeId: redeemer });

    await expect(
      materializeInviteRelations(db, {
        inviteId: row.id,
        inviterId: inviter,
        redeemerId: redeemer,
        relationValue: null,
      }),
    ).resolves.toBeUndefined();

    const rels = await db.select().from(relations).where(eq(relations.relatorId, redeemer));
    expect(rels).toEqual([]);
  });

  it("rolls back materialized rows when the surrounding transaction fails", async () => {
    const r = await createInvite({
      createdBy: inviter,
      note: "atomic rollback verification",
      hints: [h1, h2],
    });
    if ("error" in r) throw new Error("seed failed");
    const [row] = await db.select({ id: invites.id }).from(invites).where(eq(invites.code, r.code));

    await expect(
      db.transaction(async (tx) => {
        await materializeInviteRelations(tx, {
          inviteId: row.id,
          inviterId: inviter,
          redeemerId: redeemer,
          relationValue: 3,
        });
        // Sanity: the rows are visible inside the open tx.
        const inside = await tx.select().from(relations).where(eq(relations.relateeId, redeemer));
        expect(inside.length).toBeGreaterThan(0);
        throw new Error("simulated failure after materialization");
      }),
    ).rejects.toThrow("simulated failure");

    // After rollback, none of the materialized rows are visible.
    const after = await db.select().from(relations).where(eq(relations.relateeId, redeemer));
    const fromRedeemer = await db.select().from(relations).where(eq(relations.relatorId, redeemer));
    expect(after).toEqual([]);
    expect(fromRedeemer).toEqual([]);
  });

  it("skips creator_value materialization when inviterId is null", async () => {
    const r = await createInvite({ createdBy: inviter, note: "null inviter materialization" });
    if ("error" in r) throw new Error("seed failed");
    const [row] = await db.select({ id: invites.id }).from(invites).where(eq(invites.code, r.code));

    await materializeInviteRelations(db, {
      inviteId: row.id,
      inviterId: null,
      redeemerId: redeemer,
      relationValue: 3,
    });

    const rels = await db.select().from(relations).where(eq(relations.relateeId, redeemer));
    expect(rels).toEqual([]);
  });
});

describe("GET /api/relations/value/:relateeId", () => {
  let me: string;
  let other: string;

  beforeEach(async () => {
    me = randomUUID();
    other = randomUUID();
    await insertUserAndProfile(me);
    await insertUserAndProfile(other);
    authAs(me);
  });

  afterEach(async () => {
    resetAuth();
    await deleteUserAndProfile(me);
    await deleteUserAndProfile(other);
  });

  const get = (relateeId: string) => app.request(`/api/relations/value/${relateeId}`);

  it("returns the value of an existing relation", async () => {
    await updateRelationValue({ relatorId: me, relateeId: other, value: 2 });
    const res = await get(other);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: 2 });
  });

  it("returns null when no relation exists", async () => {
    const res = await get(other);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: null });
  });

  it("rejects a malformed UUID in the path", async () => {
    expect((await get("not-a-uuid")).status).toBe(400);
  });
});

describe("PUT /api/relations/value/:relateeId", () => {
  let me: string;
  let other: string;

  beforeEach(async () => {
    me = randomUUID();
    other = randomUUID();
    await insertUserAndProfile(me);
    await insertUserAndProfile(other);
    authAs(me);
  });

  afterEach(async () => {
    resetAuth();
    await deleteUserAndProfile(me);
    await deleteUserAndProfile(other);
  });

  const put = (relateeId: string, body: unknown) =>
    app.request(`/api/relations/value/${relateeId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("rates a member and returns 200", async () => {
    const res = await put(other, { value: 3 });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(relations).where(eq(relations.relatorId, me));
    expect(row.value).toBe(3);
  });

  it("rejects value outside 1..4", async () => {
    expect((await put(other, { value: 0 })).status).toBe(400);
    expect((await put(other, { value: 5 })).status).toBe(400);
    expect((await put(other, { value: "3" })).status).toBe(400);
  });

  it("rejects self-relating", async () => {
    const res = await put(me, { value: 3 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("self_relating");
  });

  it("404s on non-existent ratee", async () => {
    const res = await put(randomUUID(), { value: 3 });
    expect(res.status).toBe(404);
  });

  it("rejects malformed UUID in path", async () => {
    const res = await put("not-a-uuid", { value: 3 });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/relations/value/:relateeId", () => {
  let me: string;
  let other: string;

  beforeEach(async () => {
    me = randomUUID();
    other = randomUUID();
    await insertUserAndProfile(me);
    await insertUserAndProfile(other);
    authAs(me);
  });

  afterEach(async () => {
    resetAuth();
    await deleteUserAndProfile(me);
    await deleteUserAndProfile(other);
  });

  const del = (relateeId: string) => app.request(`/api/relations/value/${relateeId}`, { method: "DELETE" });

  it("removes the caller's relationship and returns 200", async () => {
    await updateRelationValue({ relatorId: me, relateeId: other, value: 3 });

    const res = await del(other);
    expect(res.status).toBe(200);

    const rows = await db.select().from(relations).where(eq(relations.relatorId, me));
    expect(rows).toHaveLength(0);
  });

  it("returns 200 even when no relation exists (idempotent)", async () => {
    const res = await del(other);
    expect(res.status).toBe(200);
  });

  it("only deletes the caller's own outgoing edge", async () => {
    // other → me exists; me deleting "other" must not touch it, since the
    // route fixes relatorId to the authed user.
    await updateRelationValue({ relatorId: other, relateeId: me, value: 4 });

    const res = await del(other);
    expect(res.status).toBe(200);

    const rows = await db.select().from(relations).where(eq(relations.relatorId, other));
    expect(rows).toHaveLength(1);
  });

  it("rejects malformed UUID in path", async () => {
    const res = await del("not-a-uuid");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/relations/candidates", () => {
  let me: string;
  let them: string;

  beforeEach(async () => {
    me = randomUUID();
    them = randomUUID();
    await insertUserAndProfile(me);
    await insertUserAndProfile(them, { displayName: "Them" });
    authAs(me);
  });

  afterEach(async () => {
    resetAuth();
    await deleteUserAndProfile(me);
    await deleteUserAndProfile(them);
  });

  it("returns the soft-hidden addedYou attribution", async () => {
    await updateRelationValue({ relatorId: them, relateeId: me, value: 4 });
    const res = await app.request("/api/relations/candidates");
    expect(res.status).toBe(200);
    const body = await res.json();
    const card = body.suggestions.find((c: { id: string }) => c.id === them);
    expect(card?.reason).toEqual({ type: "addedYou" });
    // No value field anywhere on the soft-hidden card.
    expect(JSON.stringify(card)).not.toContain('"value"');
  });
});

describe("POST /api/relations/hint (admin-only)", () => {
  let admin: string;
  let nonAdmin: string;
  let target: string;
  let relator: string;

  beforeEach(async () => {
    admin = randomUUID();
    nonAdmin = randomUUID();
    target = randomUUID();
    relator = randomUUID();
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(nonAdmin);
    await insertUserAndProfile(target);
    await insertUserAndProfile(relator);
  });

  afterEach(async () => {
    resetAuth();
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(nonAdmin);
    await deleteUserAndProfile(target);
    await deleteUserAndProfile(relator);
  });

  const post = (body: unknown) =>
    app.request("/api/relations/hint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("creates a hint when admin", async () => {
    authAs(admin);
    const res = await post({ relatorId: relator, relateeId: target });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(relations).where(eq(relations.relatorId, relator));
    expect(row.isHint).toBe(true);
    expect(row.value).toBeNull();
    expect(row.hintedBy).toBe(admin);
  });

  it("404s when non-admin", async () => {
    authAs(nonAdmin);
    const res = await post({ relatorId: relator, relateeId: target });
    expect(res.status).toBe(404);
  });

  it("400 on self-relating", async () => {
    authAs(admin);
    const res = await post({ relatorId: relator, relateeId: relator });
    expect(res.status).toBe(400);
  });

  it("404 when relator or relatee profile missing", async () => {
    authAs(admin);
    const res = await post({ relatorId: randomUUID(), relateeId: target });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/relations/hint/:relatorId/:relateeId (admin-only)", () => {
  let admin: string;
  let nonAdmin: string;
  let relator: string;
  let target: string;

  beforeEach(async () => {
    admin = randomUUID();
    nonAdmin = randomUUID();
    relator = randomUUID();
    target = randomUUID();
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(nonAdmin);
    await insertUserAndProfile(relator);
    await insertUserAndProfile(target);
  });

  afterEach(async () => {
    resetAuth();
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(nonAdmin);
    await deleteUserAndProfile(relator);
    await deleteUserAndProfile(target);
  });

  it("deletes a hint when admin", async () => {
    await db.insert(relations).values({
      relatorId: relator,
      relateeId: target,
      value: null,
      isHint: true,
      hintedBy: admin,
    });
    authAs(admin);
    const res = await app.request(`/api/relations/hint/${relator}/${target}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const rows = await db.select().from(relations).where(eq(relations.relatorId, relator));
    expect(rows).toEqual([]);
  });

  it("refuses to delete a confirmed relationship (404)", async () => {
    await updateRelationValue({ relatorId: relator, relateeId: target, value: 3 });
    authAs(admin);
    const res = await app.request(`/api/relations/hint/${relator}/${target}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    const rows = await db.select().from(relations).where(eq(relations.relatorId, relator));
    expect(rows).toHaveLength(1);
  });

  it("404s when non-admin", async () => {
    await db.insert(relations).values({
      relatorId: relator,
      relateeId: target,
      value: null,
      isHint: true,
      hintedBy: admin,
    });
    authAs(nonAdmin);
    const res = await app.request(`/api/relations/hint/${relator}/${target}`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
