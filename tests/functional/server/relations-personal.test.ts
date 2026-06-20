import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import app from "@/server/api";
import { db } from "@/server/db";
import { updateRelationValue } from "@/server/relations";
import { getPersonalWeb } from "@/server/relations-personal";
import { profiles, relations } from "@/server/schema";

import { authAs, deleteUserAndProfile, insertUserAndProfile, resetAuth } from "./relation-helpers";

describe("getPersonalWeb", () => {
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
    const sub = await getPersonalWeb({ centerId: center, includeIncoming: false, includeOutgoing: true, hops: 1 });
    expect(sub.nodes.map((n) => n.id)).toEqual([center]);
    expect(sub.edges).toEqual([]);
  });

  it("hops=1, outgoing only — returns my relationships", async () => {
    await updateRelationValue({ relatorId: center, relateeId: a, value: 3 });
    await updateRelationValue({ relatorId: center, relateeId: b, value: 2 });
    const sub = await getPersonalWeb({ centerId: center, includeIncoming: false, includeOutgoing: true, hops: 1 });
    expect(new Set(sub.nodes.map((n) => n.id))).toEqual(new Set([center, a, b]));
    expect(sub.edges).toHaveLength(2);
    expect(sub.edges.every((e) => e.relatorId === center)).toBe(true);
  });

  it("hops=1, incoming only — returns relationships pointing at me", async () => {
    await updateRelationValue({ relatorId: a, relateeId: center, value: 3 });
    const sub = await getPersonalWeb({ centerId: center, includeIncoming: true, includeOutgoing: false, hops: 1 });
    expect(new Set(sub.nodes.map((n) => n.id))).toEqual(new Set([center, a]));
    expect(sub.edges).toHaveLength(1);
    expect(sub.edges[0]).toMatchObject({ relatorId: a, relateeId: center, value: 3 });
  });

  it("paired counter-edges render asymmetry as two rows", async () => {
    await updateRelationValue({ relatorId: center, relateeId: a, value: 3 });
    await updateRelationValue({ relatorId: a, relateeId: center, value: 1 });
    const sub = await getPersonalWeb({ centerId: center, includeIncoming: true, includeOutgoing: true, hops: 1 });
    expect(sub.edges).toHaveLength(2);
    const values = sub.edges.map((e) => `${e.relatorId === center ? "out" : "in"}:${e.value}`).sort();
    expect(values).toEqual(["in:1", "out:3"]);
  });

  it("filters out hint rows entirely", async () => {
    await db.insert(relations).values({
      relatorId: center,
      relateeId: a,
      value: null,
      isHint: true,
      hintedBy: b,
    });
    const sub = await getPersonalWeb({ centerId: center, includeIncoming: false, includeOutgoing: true, hops: 1 });
    expect(sub.edges).toEqual([]);
    expect(sub.nodes.map((n) => n.id)).toEqual([center]);
  });

  it("hops=2 includes second-degree neighbors and their edges", async () => {
    const c = randomUUID();
    await insertUserAndProfile(c, { displayName: "C" });
    try {
      await updateRelationValue({ relatorId: center, relateeId: a, value: 3 });
      await updateRelationValue({ relatorId: a, relateeId: c, value: 4 });
      const sub = await getPersonalWeb({ centerId: center, includeIncoming: false, includeOutgoing: true, hops: 2 });
      const nodeIds = new Set(sub.nodes.map((n) => n.id));
      expect(nodeIds.has(c)).toBe(true);
      expect(sub.edges.some((e) => e.relatorId === a && e.relateeId === c)).toBe(true);
    } finally {
      await deleteUserAndProfile(c);
    }
  });

  it("renders gracefully at N=1 (just self, no edges)", async () => {
    const sub = await getPersonalWeb({ centerId: center, includeIncoming: true, includeOutgoing: true, hops: 2 });
    expect(sub.nodes).toHaveLength(1);
    expect(sub.edges).toEqual([]);
  });

  it("drops hidden nodes and any edge touching one (non-admin viewer)", async () => {
    await updateRelationValue({ relatorId: center, relateeId: a, value: 3 });
    await updateRelationValue({ relatorId: center, relateeId: b, value: 2 });
    await db.update(profiles).set({ hidden: true }).where(eq(profiles.id, b));

    const sub = await getPersonalWeb({
      centerId: center,
      includeIncoming: false,
      includeOutgoing: true,
      hops: 1,
    });
    expect(new Set(sub.nodes.map((n) => n.id))).toEqual(new Set([center, a]));
    expect(sub.edges).toHaveLength(1);
    expect(sub.edges[0]).toMatchObject({ relatorId: center, relateeId: a });
  });

  it("hops=2 drops a hidden second-degree neighbor and the edge that reaches it", async () => {
    const c = randomUUID();
    await insertUserAndProfile(c, { displayName: "C" });
    try {
      await updateRelationValue({ relatorId: center, relateeId: a, value: 3 });
      await updateRelationValue({ relatorId: a, relateeId: c, value: 4 });
      await db.update(profiles).set({ hidden: true }).where(eq(profiles.id, c));

      const sub = await getPersonalWeb({
        centerId: center,
        includeIncoming: false,
        includeOutgoing: true,
        hops: 2,
      });
      expect(sub.nodes.map((n) => n.id).includes(c)).toBe(false);
      expect(sub.edges.some((e) => e.relateeId === c)).toBe(false);
    } finally {
      await deleteUserAndProfile(c);
    }
  });

  it("drops a deactivated neighbor and their edge from the map", async () => {
    await updateRelationValue({ relatorId: center, relateeId: a, value: 3 });
    await updateRelationValue({ relatorId: center, relateeId: b, value: 2 });
    await db.update(profiles).set({ deactivatedAt: new Date() }).where(eq(profiles.id, b));

    const sub = await getPersonalWeb({
      centerId: center,
      includeIncoming: false,
      includeOutgoing: true,
      hops: 1,
    });
    expect(sub.nodes.map((n) => n.id).includes(b)).toBe(false);
    expect(sub.edges.some((e) => e.relateeId === b)).toBe(false);
    expect(sub.nodes.map((n) => n.id).includes(a)).toBe(true);
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
    resetAuth();
    await deleteUserAndProfile(me);
    await deleteUserAndProfile(other);
  });

  it("default returns my outgoing first-hop subgraph", async () => {
    await updateRelationValue({ relatorId: me, relateeId: other, value: 2 });
    const res = await app.request("/api/relations/subgraph");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.centerId).toBe(me);
    expect(body.edges).toHaveLength(1);
    expect(body.edges[0]).toMatchObject({ relatorId: me, relateeId: other, value: 2 });
  });

  it("query params widen the view", async () => {
    await updateRelationValue({ relatorId: me, relateeId: other, value: 2 });
    await updateRelationValue({ relatorId: other, relateeId: me, value: 4 });
    const res = await app.request("/api/relations/subgraph?in=true&hops=1");
    const body = await res.json();
    expect(body.edges).toHaveLength(2);
  });
});
