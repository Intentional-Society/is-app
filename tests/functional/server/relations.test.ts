import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";

import app from "@/server/api";
import { db } from "@/server/db";
import { createInvite } from "@/server/invites";
import { getCandidates, getSubgraph, materializeInviteRelations, rateMember } from "@/server/relations";
import { inviteHints, invites, profiles, relations } from "@/server/schema";

const mockCreateServerClient = vi.mocked(createServerClient);

const fakeUser = (id: string): User =>
  ({
    id,
    email: `${id}@testfake.local`,
    user_metadata: {},
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  }) as User;

const authAs = (userId: string) => {
  mockCreateServerClient.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: fakeUser(userId) },
        error: null,
      }),
    },
    // biome-ignore lint/suspicious/noExplicitAny: test mock shape
  } as any);
};

const insertUserAndProfile = async (id: string, opts: { displayName?: string; isAdmin?: boolean } = {}) => {
  await db.execute(
    sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${`${id}@testfake.local`}, false, false)`,
  );
  await db.insert(profiles).values({
    id,
    displayName: opts.displayName ?? null,
    isAdmin: opts.isAdmin ?? false,
  });
};

const deleteUserAndProfile = async (id: string) => {
  await db.delete(relations).where(eq(relations.raterId, id));
  await db.delete(relations).where(eq(relations.rateeId, id));
  await db.delete(invites).where(eq(invites.createdBy, id));
  await db.delete(profiles).where(eq(profiles.id, id));
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
};

describe("rateMember", () => {
  let raterId: string;
  let rateeId: string;

  beforeEach(async () => {
    raterId = randomUUID();
    rateeId = randomUUID();
    await insertUserAndProfile(raterId);
    await insertUserAndProfile(rateeId);
  });

  afterEach(async () => {
    await deleteUserAndProfile(raterId);
    await deleteUserAndProfile(rateeId);
  });

  it("creates a confirmed rating row", async () => {
    const r = await rateMember({ raterId, rateeId, value: 3 });
    expect(r).toEqual({ ok: true });

    const [row] = await db.select().from(relations).where(eq(relations.raterId, raterId));
    expect(row.value).toBe(3);
    expect(row.isHint).toBe(false);
  });

  it("re-rating updates value and bumps updatedAt without changing the primary key", async () => {
    await rateMember({ raterId, rateeId, value: 2 });
    const [first] = await db.select().from(relations).where(eq(relations.raterId, raterId));

    await new Promise((r) => setTimeout(r, 10));
    await rateMember({ raterId, rateeId, value: 4 });

    const rows = await db.select().from(relations).where(eq(relations.raterId, raterId));
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(4);
    expect(rows[0].updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
  });

  it("flips isHint to false on confirmation while preserving hintedBy", async () => {
    const hinterId = randomUUID();
    await insertUserAndProfile(hinterId);
    try {
      await db.insert(relations).values({
        raterId,
        rateeId,
        value: null,
        isHint: true,
        hintedBy: hinterId,
      });

      const r = await rateMember({ raterId, rateeId, value: 2 });
      expect(r).toEqual({ ok: true });

      const [row] = await db.select().from(relations).where(eq(relations.raterId, raterId));
      expect(row.value).toBe(2);
      expect(row.isHint).toBe(false);
      expect(row.hintedBy).toBe(hinterId);
    } finally {
      await deleteUserAndProfile(hinterId);
    }
  });

  it("rejects self-rating before hitting the DB constraint", async () => {
    const r = await rateMember({ raterId, rateeId: raterId, value: 3 });
    expect(r).toEqual({ error: "self_rating" });
  });

  it("rejects rating a non-existent ratee", async () => {
    const r = await rateMember({ raterId, rateeId: randomUUID(), value: 3 });
    expect(r).toEqual({ error: "ratee_not_found" });
  });
});

describe("getCandidates", () => {
  let me: string;

  beforeEach(async () => {
    me = randomUUID();
    await insertUserAndProfile(me, { displayName: "Me" });
  });

  afterEach(async () => {
    await deleteUserAndProfile(me);
  });

  it("returns an empty feed for a fresh user with no signals", async () => {
    const feed = await getCandidates(me);
    expect(feed.suggestions).toEqual([]);
    expect(feed.otherMembers).toEqual([]);
  });

  it("source 1 — surfaces people who rated me, without their value (soft-hide)", async () => {
    const them = randomUUID();
    await insertUserAndProfile(them, { displayName: "Them" });
    try {
      await rateMember({ raterId: them, rateeId: me, value: 4 });
      const feed = await getCandidates(me);
      expect(feed.suggestions).toHaveLength(1);
      expect(feed.suggestions[0].id).toBe(them);
      expect(feed.suggestions[0].reason).toEqual({ type: "ratedYou" });
      // No value field anywhere on the card.
      expect(JSON.stringify(feed.suggestions[0])).not.toContain('"value"');
    } finally {
      await deleteUserAndProfile(them);
    }
  });

  it("source 1 — excludes anyone I've already rated", async () => {
    const them = randomUUID();
    await insertUserAndProfile(them, { displayName: "Them" });
    try {
      await rateMember({ raterId: them, rateeId: me, value: 3 });
      await rateMember({ raterId: me, rateeId: them, value: 2 });
      const feed = await getCandidates(me);
      expect(feed.suggestions).toEqual([]);
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
        raterId: me,
        rateeId: target,
        value: null,
        isHint: true,
        hintedBy: hinter,
      });
      const feed = await getCandidates(me);
      expect(feed.suggestions).toHaveLength(1);
      expect(feed.suggestions[0].id).toBe(target);
      expect(feed.suggestions[0].reason).toEqual({
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
      await rateMember({ raterId: inviter, rateeId: friend, value: 4 });
      await rateMember({ raterId: inviter, rateeId: acquaintance, value: 2 });

      const feed = await getCandidates(me);
      // Suggestions empty (acquaintance value < 3 doesn't qualify).
      const ids = feed.otherMembers.map((c) => c.id);
      expect(ids).toContain(friend);
      expect(ids).not.toContain(acquaintance);
      const friendCard = feed.otherMembers.find((c) => c.id === friend);
      expect(friendCard?.reason).toEqual({
        type: "viaInviter",
        inviter: { id: inviter, displayName: "Inviter", slug: null },
      });
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
      await db
        .update(profiles)
        .set({ lastUpdatedWeb: sql`now() - interval '1 day'` })
        .where(eq(profiles.id, me));
      await db
        .update(profiles)
        .set({ lastUpdatedWeb: sql`now()` })
        .where(eq(profiles.id, recent));
      await db
        .update(profiles)
        .set({ lastUpdatedWeb: sql`now() - interval '7 days'` })
        .where(eq(profiles.id, stale));

      const feed = await getCandidates(me);
      const ids = feed.otherMembers.map((c) => c.id);
      expect(ids).toContain(recent);
      expect(ids).not.toContain(stale);
      expect(feed.otherMembers.find((c) => c.id === recent)?.reason).toEqual({ type: "recentlyActive" });
    } finally {
      await deleteUserAndProfile(recent);
      await deleteUserAndProfile(stale);
    }
  });

  it("a single person never appears twice — highest-priority source wins", async () => {
    const them = randomUUID();
    await insertUserAndProfile(them, { displayName: "Them" });
    try {
      // They rated me (source 1).
      await rateMember({ raterId: them, rateeId: me, value: 4 });
      // And they're recently active (source 4).
      await db
        .update(profiles)
        .set({ lastUpdatedWeb: sql`now()` })
        .where(eq(profiles.id, them));
      await db
        .update(profiles)
        .set({ lastUpdatedWeb: sql`now() - interval '1 day'` })
        .where(eq(profiles.id, me));

      const feed = await getCandidates(me);
      const allCards = [...feed.suggestions, ...feed.otherMembers];
      const occurrences = allCards.filter((c) => c.id === them).length;
      expect(occurrences).toBe(1);
      // Source 1 wins.
      expect(feed.suggestions[0].id).toBe(them);
      expect(feed.suggestions[0].reason).toEqual({ type: "ratedYou" });
    } finally {
      await deleteUserAndProfile(them);
    }
  });

  it("excludes self under all sources", async () => {
    await db
      .update(profiles)
      .set({ lastUpdatedWeb: sql`now()` })
      .where(eq(profiles.id, me));
    const feed = await getCandidates(me);
    expect([...feed.suggestions, ...feed.otherMembers].map((c) => c.id)).not.toContain(me);
  });
});

describe("getSubgraph", () => {
  let center: string;
  let a: string;
  let b: string;

  beforeEach(async () => {
    center = randomUUID();
    a = randomUUID();
    b = randomUUID();
    await insertUserAndProfile(center, { displayName: "Center" });
    await insertUserAndProfile(a, { displayName: "A" });
    await insertUserAndProfile(b, { displayName: "B" });
  });

  afterEach(async () => {
    await deleteUserAndProfile(center);
    await deleteUserAndProfile(a);
    await deleteUserAndProfile(b);
  });

  it("hops=1, outgoing only, no edges → just the center node", async () => {
    const sub = await getSubgraph({ centerId: center, includeIncoming: false, includeOutgoing: true, hops: 1 });
    expect(sub.nodes.map((n) => n.id)).toEqual([center]);
    expect(sub.edges).toEqual([]);
  });

  it("hops=1, outgoing only — returns my ratings", async () => {
    await rateMember({ raterId: center, rateeId: a, value: 3 });
    await rateMember({ raterId: center, rateeId: b, value: 2 });
    const sub = await getSubgraph({ centerId: center, includeIncoming: false, includeOutgoing: true, hops: 1 });
    expect(new Set(sub.nodes.map((n) => n.id))).toEqual(new Set([center, a, b]));
    expect(sub.edges).toHaveLength(2);
    expect(sub.edges.every((e) => e.raterId === center)).toBe(true);
  });

  it("hops=1, incoming only — returns ratings of me", async () => {
    await rateMember({ raterId: a, rateeId: center, value: 3 });
    const sub = await getSubgraph({ centerId: center, includeIncoming: true, includeOutgoing: false, hops: 1 });
    expect(new Set(sub.nodes.map((n) => n.id))).toEqual(new Set([center, a]));
    expect(sub.edges).toHaveLength(1);
    expect(sub.edges[0]).toMatchObject({ raterId: a, rateeId: center, value: 3 });
  });

  it("paired counter-edges render asymmetry as two rows", async () => {
    await rateMember({ raterId: center, rateeId: a, value: 3 });
    await rateMember({ raterId: a, rateeId: center, value: 1 });
    const sub = await getSubgraph({ centerId: center, includeIncoming: true, includeOutgoing: true, hops: 1 });
    expect(sub.edges).toHaveLength(2);
    const values = sub.edges.map((e) => `${e.raterId === center ? "out" : "in"}:${e.value}`).sort();
    expect(values).toEqual(["in:1", "out:3"]);
  });

  it("filters out hint rows entirely", async () => {
    await db.insert(relations).values({
      raterId: center,
      rateeId: a,
      value: null,
      isHint: true,
      hintedBy: b,
    });
    const sub = await getSubgraph({ centerId: center, includeIncoming: false, includeOutgoing: true, hops: 1 });
    expect(sub.edges).toEqual([]);
    expect(sub.nodes.map((n) => n.id)).toEqual([center]);
  });

  it("hops=2 includes second-degree neighbors and their edges", async () => {
    const c = randomUUID();
    await insertUserAndProfile(c, { displayName: "C" });
    try {
      await rateMember({ raterId: center, rateeId: a, value: 3 });
      await rateMember({ raterId: a, rateeId: c, value: 4 });
      const sub = await getSubgraph({ centerId: center, includeIncoming: false, includeOutgoing: true, hops: 2 });
      const nodeIds = new Set(sub.nodes.map((n) => n.id));
      expect(nodeIds.has(c)).toBe(true);
      expect(sub.edges.some((e) => e.raterId === a && e.rateeId === c)).toBe(true);
    } finally {
      await deleteUserAndProfile(c);
    }
  });

  it("renders gracefully at N=1 (just self, no edges)", async () => {
    const sub = await getSubgraph({ centerId: center, includeIncoming: true, includeOutgoing: true, hops: 2 });
    expect(sub.nodes).toHaveLength(1);
    expect(sub.edges).toEqual([]);
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

  it("inserts a confirmed inviter→redeemer rating from creator_value", async () => {
    const r = await createInvite({ createdBy: inviter, note: "creator value materialization" });
    if ("error" in r) throw new Error("seed failed");
    const [row] = await db.select({ id: invites.id }).from(invites).where(eq(invites.code, r.code));

    await materializeInviteRelations(db, {
      inviteId: row.id,
      inviterId: inviter,
      redeemerId: redeemer,
      creatorValue: 3,
    });

    const [rel] = await db
      .select()
      .from(relations)
      .where(and(eq(relations.raterId, inviter), eq(relations.rateeId, redeemer)));
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
      creatorValue: null,
    });

    const rels = await db.select().from(relations).where(eq(relations.raterId, redeemer));
    expect(rels).toHaveLength(2);
    for (const rel of rels) {
      expect(rel.isHint).toBe(true);
      expect(rel.value).toBeNull();
      expect(rel.hintedBy).toBe(inviter);
      expect([h1, h2]).toContain(rel.rateeId);
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
      creatorValue: null,
    });

    const rels = await db
      .select()
      .from(relations)
      .where(eq(relations.raterId, redeemer));
    expect(rels).toEqual([]);
  });

  it("skips hint rows that point at the redeemer (no relations_no_self violation)", async () => {
    const r = await createInvite({ createdBy: inviter, note: "self-hint defensive skip" });
    if ("error" in r) throw new Error("seed failed");
    const [row] = await db.select({ id: invites.id }).from(invites).where(eq(invites.code, r.code));
    // Bypass the API validator to construct the pathological row.
    await db.insert(inviteHints).values({ inviteId: row.id, rateeId: redeemer });

    await expect(
      materializeInviteRelations(db, {
        inviteId: row.id,
        inviterId: inviter,
        redeemerId: redeemer,
        creatorValue: null,
      }),
    ).resolves.toBeUndefined();

    const rels = await db.select().from(relations).where(eq(relations.raterId, redeemer));
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
          creatorValue: 3,
        });
        // Sanity: the rows are visible inside the open tx.
        const inside = await tx.select().from(relations).where(eq(relations.rateeId, redeemer));
        expect(inside.length).toBeGreaterThan(0);
        throw new Error("simulated failure after materialization");
      }),
    ).rejects.toThrow("simulated failure");

    // After rollback, none of the materialized rows are visible.
    const after = await db.select().from(relations).where(eq(relations.rateeId, redeemer));
    const fromRedeemer = await db.select().from(relations).where(eq(relations.raterId, redeemer));
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
      creatorValue: 3,
    });

    const rels = await db.select().from(relations).where(eq(relations.rateeId, redeemer));
    expect(rels).toEqual([]);
  });
});

describe("PUT /api/relations/:rateeId", () => {
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
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(me);
    await deleteUserAndProfile(other);
  });

  const put = (rateeId: string, body: unknown) =>
    app.request(`/api/relations/${rateeId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("rates a member and returns 200", async () => {
    const res = await put(other, { value: 3 });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(relations).where(eq(relations.raterId, me));
    expect(row.value).toBe(3);
  });

  it("rejects value outside 1..4", async () => {
    expect((await put(other, { value: 0 })).status).toBe(400);
    expect((await put(other, { value: 5 })).status).toBe(400);
    expect((await put(other, { value: "3" })).status).toBe(400);
  });

  it("rejects self-rating", async () => {
    const res = await put(me, { value: 3 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("self_rating");
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
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(me);
    await deleteUserAndProfile(them);
  });

  it("returns the soft-hidden ratedYou attribution", async () => {
    await rateMember({ raterId: them, rateeId: me, value: 4 });
    const res = await app.request("/api/relations/candidates");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0].reason).toEqual({ type: "ratedYou" });
    expect(JSON.stringify(body)).not.toContain('"value"');
  });
});

describe("GET /api/relations/subgraph", () => {
  let me: string;
  let other: string;

  beforeEach(async () => {
    me = randomUUID();
    other = randomUUID();
    await insertUserAndProfile(me);
    await insertUserAndProfile(other, { displayName: "Other" });
    authAs(me);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(me);
    await deleteUserAndProfile(other);
  });

  it("default returns my outgoing first-hop subgraph", async () => {
    await rateMember({ raterId: me, rateeId: other, value: 2 });
    const res = await app.request("/api/relations/subgraph");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.centerId).toBe(me);
    expect(body.edges).toHaveLength(1);
    expect(body.edges[0]).toMatchObject({ raterId: me, rateeId: other, value: 2 });
  });

  it("query params widen the view", async () => {
    await rateMember({ raterId: me, rateeId: other, value: 2 });
    await rateMember({ raterId: other, rateeId: me, value: 4 });
    const res = await app.request("/api/relations/subgraph?in=true&hops=1");
    const body = await res.json();
    expect(body.edges).toHaveLength(2);
  });
});

describe("POST /api/relations/hint (admin-only)", () => {
  let admin: string;
  let nonAdmin: string;
  let target: string;
  let rater: string;

  beforeEach(async () => {
    admin = randomUUID();
    nonAdmin = randomUUID();
    target = randomUUID();
    rater = randomUUID();
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(nonAdmin);
    await insertUserAndProfile(target);
    await insertUserAndProfile(rater);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(nonAdmin);
    await deleteUserAndProfile(target);
    await deleteUserAndProfile(rater);
  });

  const post = (body: unknown) =>
    app.request("/api/relations/hint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("creates a hint when admin", async () => {
    authAs(admin);
    const res = await post({ raterId: rater, rateeId: target });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(relations).where(eq(relations.raterId, rater));
    expect(row.isHint).toBe(true);
    expect(row.value).toBeNull();
    expect(row.hintedBy).toBe(admin);
  });

  it("403s when non-admin", async () => {
    authAs(nonAdmin);
    const res = await post({ raterId: rater, rateeId: target });
    expect(res.status).toBe(403);
  });

  it("400 on self-rating", async () => {
    authAs(admin);
    const res = await post({ raterId: rater, rateeId: rater });
    expect(res.status).toBe(400);
  });

  it("404 when rater or ratee profile missing", async () => {
    authAs(admin);
    const res = await post({ raterId: randomUUID(), rateeId: target });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/relations/hint/:raterId/:rateeId (admin-only)", () => {
  let admin: string;
  let nonAdmin: string;
  let rater: string;
  let target: string;

  beforeEach(async () => {
    admin = randomUUID();
    nonAdmin = randomUUID();
    rater = randomUUID();
    target = randomUUID();
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(nonAdmin);
    await insertUserAndProfile(rater);
    await insertUserAndProfile(target);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(nonAdmin);
    await deleteUserAndProfile(rater);
    await deleteUserAndProfile(target);
  });

  it("deletes a hint when admin", async () => {
    await db.insert(relations).values({
      raterId: rater,
      rateeId: target,
      value: null,
      isHint: true,
      hintedBy: admin,
    });
    authAs(admin);
    const res = await app.request(`/api/relations/hint/${rater}/${target}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const rows = await db.select().from(relations).where(eq(relations.raterId, rater));
    expect(rows).toEqual([]);
  });

  it("refuses to delete a confirmed rating (404)", async () => {
    await rateMember({ raterId: rater, rateeId: target, value: 3 });
    authAs(admin);
    const res = await app.request(`/api/relations/hint/${rater}/${target}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    const rows = await db.select().from(relations).where(eq(relations.raterId, rater));
    expect(rows).toHaveLength(1);
  });

  it("403s when non-admin", async () => {
    await db.insert(relations).values({
      raterId: rater,
      rateeId: target,
      value: null,
      isHint: true,
      hintedBy: admin,
    });
    authAs(nonAdmin);
    const res = await app.request(`/api/relations/hint/${rater}/${target}`, { method: "DELETE" });
    expect(res.status).toBe(403);
  });
});
