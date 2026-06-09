import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import app from "@/server/api";
import { db } from "@/server/db";
import { updateRelationValue } from "@/server/relations";
import { getProfileMiniMap } from "@/server/relations-mini-map";
import { profiles } from "@/server/schema";

import { authAs, deleteUserAndProfile, insertUserAndProfile, resetAuth } from "./relation-helpers";

describe("getProfileMiniMap", () => {
  let viewer: string;
  let them: string;
  let created: string[];

  // Creates a member, tracks it for teardown, and returns its id.
  const mk = async (displayName: string): Promise<string> => {
    const id = randomUUID();
    await insertUserAndProfile(id, { displayName });
    created.push(id);
    return id;
  };

  // n fresh members each related FROM `them` at `value` — strong-connection
  // fodder for the budget tests.
  const mkTier = async (prefix: string, n: number, value: 1 | 2 | 3 | 4): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = await mk(`${prefix}${i}`);
      await updateRelationValue({ relatorId: them, relateeId: id, value });
      ids.push(id);
    }
    return ids;
  };

  beforeEach(async () => {
    created = [];
    viewer = await mk("Viewer");
    them = await mk("Them");
  });

  afterEach(async () => {
    for (const id of created) await deleteUserAndProfile(id);
  });

  it("finds the shortest path from the profile member back to the viewer", async () => {
    const x = await mk("X");
    await updateRelationValue({ relatorId: them, relateeId: x, value: 4 });
    await updateRelationValue({ relatorId: x, relateeId: viewer, value: 3 });

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    expect(map.emphasizedId).toBe(them);
    expect(map.viewerId).toBe(viewer);
    expect(map.pathToViewer).toEqual([them, x, viewer]);
    expect(new Set(map.nodes.map((n) => n.id))).toEqual(new Set([them, x, viewer]));
  });

  it("renders just the member (no viewer node) when no path reaches the viewer", async () => {
    const a = await mk("A");
    await updateRelationValue({ relatorId: them, relateeId: a, value: 4 });

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    expect(map.pathToViewer).toEqual([]);
    const ids = new Set(map.nodes.map((n) => n.id));
    expect(ids.has(viewer)).toBe(false);
    expect(ids.has(them)).toBe(true);
    expect(ids.has(a)).toBe(true);
  });

  it("includes 4/3/2 strong-connection tiers that fit the budget", async () => {
    const four = await mk("Four");
    const three = await mk("Three");
    const two = await mk("Two");
    await updateRelationValue({ relatorId: them, relateeId: four, value: 4 });
    await updateRelationValue({ relatorId: them, relateeId: three, value: 3 });
    await updateRelationValue({ relatorId: them, relateeId: two, value: 2 });

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    expect(new Set(map.nodes.map((n) => n.id))).toEqual(new Set([them, four, three, two]));
  });

  it("never counts value-1 relations as strong connections", async () => {
    const one = await mk("One");
    await updateRelationValue({ relatorId: them, relateeId: one, value: 1 });

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    expect(map.nodes.map((n) => n.id)).toEqual([them]);
  });

  it("stops at the tier that would overflow the budget, skipping weaker tiers", async () => {
    const fours = await mkTier("F", 2, 4); // 4s fit: them + 2 = 3 nodes
    const threes = await mkTier("T", 9, 3); // 3s would push to 12 > 10 → stop
    const two = await mk("Two");
    await updateRelationValue({ relatorId: them, relateeId: two, value: 2 });

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them, maxNodes: 10 });
    const ids = new Set(map.nodes.map((n) => n.id));
    expect(ids).toEqual(new Set([them, ...fours]));
    expect(threes.some((t) => ids.has(t))).toBe(false);
    expect(ids.has(two)).toBe(false);
  });

  it("always includes every 4 even when 4s alone exceed the budget", async () => {
    const fours = await mkTier("F", 12, 4);

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them, maxNodes: 10 });
    const ids = new Set(map.nodes.map((n) => n.id));
    for (const f of fours) expect(ids.has(f)).toBe(true);
    expect(ids.size).toBe(13); // them + 12 fours
  });

  it("prunes a hidden strong connection for a non-admin viewer", async () => {
    const hidden = await mk("Hidden");
    await updateRelationValue({ relatorId: them, relateeId: hidden, value: 4 });
    await db.update(profiles).set({ hidden: true }).where(eq(profiles.id, hidden));

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    expect(map.nodes.map((n) => n.id)).toEqual([them]);
  });

  it("includeHidden keeps a hidden strong connection (admin viewer)", async () => {
    const hidden = await mk("Hidden");
    await updateRelationValue({ relatorId: them, relateeId: hidden, value: 4 });
    await db.update(profiles).set({ hidden: true }).where(eq(profiles.id, hidden));

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them, includeHidden: true });
    expect(new Set(map.nodes.map((n) => n.id))).toEqual(new Set([them, hidden]));
  });

  it("returns both path edges and strong-connection edges among the node set", async () => {
    const x = await mk("X");
    await updateRelationValue({ relatorId: them, relateeId: x, value: 4 }); // path + strong
    await updateRelationValue({ relatorId: x, relateeId: viewer, value: 3 }); // path

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    expect(map.edges).toHaveLength(2);
    expect(map.edges.some((e) => e.relatorId === them && e.relateeId === x)).toBe(true);
    expect(map.edges.some((e) => e.relatorId === x && e.relateeId === viewer)).toBe(true);
  });
});

describe("GET /api/relations/mini-map/:profileId", () => {
  let viewer: string;
  let them: string;
  let admin: string;
  let hidden: string;

  beforeEach(async () => {
    viewer = randomUUID();
    them = randomUUID();
    admin = randomUUID();
    hidden = randomUUID();
    await insertUserAndProfile(viewer, { displayName: "Viewer" });
    await insertUserAndProfile(them, { displayName: "Them" });
    await insertUserAndProfile(admin, { displayName: "Admin", isAdmin: true });
    await insertUserAndProfile(hidden, { displayName: "Hidden" });
  });

  afterEach(async () => {
    resetAuth();
    await deleteUserAndProfile(viewer);
    await deleteUserAndProfile(them);
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(hidden);
  });

  it("returns the mini-map for the profile member", async () => {
    await updateRelationValue({ relatorId: them, relateeId: viewer, value: 3 });
    authAs(viewer);
    const res = await app.request(`/api/relations/mini-map/${them}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.emphasizedId).toBe(them);
    expect(body.viewerId).toBe(viewer);
    expect(body.pathToViewer).toEqual([them, viewer]);
  });

  it("400s on a non-UUID profile id", async () => {
    authAs(viewer);
    const res = await app.request("/api/relations/mini-map/not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("prunes a hidden node for a non-admin but keeps it for an admin", async () => {
    await updateRelationValue({ relatorId: them, relateeId: hidden, value: 4 });
    await db.update(profiles).set({ hidden: true }).where(eq(profiles.id, hidden));

    authAs(viewer);
    const nonAdminBody = await (await app.request(`/api/relations/mini-map/${them}`)).json();
    expect(nonAdminBody.nodes.map((n: { id: string }) => n.id)).not.toContain(hidden);

    authAs(admin);
    const adminBody = await (await app.request(`/api/relations/mini-map/${them}`)).json();
    expect(adminBody.nodes.map((n: { id: string }) => n.id)).toContain(hidden);
  });
});
