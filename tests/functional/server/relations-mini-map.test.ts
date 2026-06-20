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
import { profiles, relations } from "@/server/schema";

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

  const relate = (relatorId: string, relateeId: string, value: 1 | 2 | 3 | 4) =>
    updateRelationValue({ relatorId, relateeId, value });

  // Direct insert so the relation's createdAt is controllable for ordering tests.
  const relateAt = (relatorId: string, relateeId: string, value: number, createdAt: Date) =>
    db.insert(relations).values({ relatorId, relateeId, value, isHint: false, createdAt });

  const ids = (map: { nodes: { id: string }[] }) => new Set(map.nodes.map((n) => n.id));

  beforeEach(async () => {
    created = [];
    viewer = await mk("Viewer");
    them = await mk("Them");
  });

  afterEach(async () => {
    for (const id of created) await deleteUserAndProfile(id);
  });

  it("includes a mutual connection and lights the path through it", async () => {
    const x = await mk("X");
    await relate(viewer, x, 3);
    await relate(x, them, 3);

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    expect(map.emphasizedId).toBe(them);
    expect(map.viewerId).toBe(viewer);
    expect(ids(map)).toEqual(new Set([them, x, viewer]));
    expect(map.pathToViewer).toEqual([them, x, viewer]);
  });

  it("ranks mutuals by descending average path value, keeping the stronger under budget", async () => {
    const strong = await mk("Strong");
    const weak = await mk("Weak");
    await relate(viewer, strong, 4);
    await relate(strong, them, 4); // avg 4
    await relate(viewer, weak, 1);
    await relate(weak, them, 1); // avg 1

    // Budget 3 = them + you + one mutual.
    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them, maxNodes: 3 });
    expect(ids(map)).toEqual(new Set([them, viewer, strong]));
    expect(map.pathToViewer).toEqual([them, strong, viewer]);
  });

  it("averages every confirmed edge on the path, both directions counted", async () => {
    // A: a clean 4/4 path → avg 4.
    const a = await mk("A");
    await relate(viewer, a, 4);
    await relate(a, them, 4);
    // B: a reciprocated 4/4 viewer edge plus a weak 1 to them → (4+4+1)/3 = 3.
    const b = await mk("B");
    await relate(viewer, b, 4);
    await relate(b, viewer, 4);
    await relate(b, them, 1);

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them, maxNodes: 3 });
    expect(ids(map)).toEqual(new Set([them, viewer, a])); // A (avg 4) beats B (avg 3)
    expect(map.pathToViewer).toEqual([them, a, viewer]);
  });

  it("adds two-hop bridges (both intermediaries) and lights the chain", async () => {
    const x = await mk("X");
    const y = await mk("Y");
    await relate(viewer, x, 3);
    await relate(x, y, 3);
    await relate(y, them, 3);

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    expect(ids(map)).toEqual(new Set([them, viewer, x, y]));
    expect(map.pathToViewer).toEqual([them, y, x, viewer]);
  });

  it("prefers a mutual over a stronger two-hop bridge under budget", async () => {
    const m = await mk("M");
    await relate(viewer, m, 2);
    await relate(m, them, 2); // mutual, avg 2
    const x = await mk("X");
    const y = await mk("Y");
    await relate(viewer, x, 4);
    await relate(x, y, 4);
    await relate(y, them, 4); // two-hop, avg 4 — stronger but lower priority

    // Budget 3 = them + you + one slot → the mutual wins on priority.
    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them, maxNodes: 3 });
    expect(ids(map)).toEqual(new Set([them, viewer, m]));
    expect(map.pathToViewer).toEqual([them, m, viewer]);
  });

  it("fills remaining slots with them's closest outgoing relations, including value 1", async () => {
    const one = await mk("One");
    await relate(them, one, 1);

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    // No path to the viewer, but value-1 still counts as a closest connection.
    expect(ids(map)).toEqual(new Set([them, viewer, one]));
    expect(map.pathToViewer).toEqual([]);
  });

  it("orders closest connections by value, then by oldest createdAt", async () => {
    const hi = await mk("Hi");
    const oldMid = await mk("OldMid");
    const newMid = await mk("NewMid");
    await relateAt(them, hi, 4, new Date("2022-06-01T00:00:00Z"));
    await relateAt(them, oldMid, 3, new Date("2020-01-01T00:00:00Z"));
    await relateAt(them, newMid, 3, new Date("2023-01-01T00:00:00Z"));

    // Budget 4 = them + you + two → the 4, then the older of the two 3s.
    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them, maxNodes: 4 });
    expect(ids(map)).toEqual(new Set([them, viewer, hi, oldMid]));
  });

  it("caps the node set at maxNodes, always including them and you", async () => {
    for (let i = 0; i < 12; i++) {
      const m = await mk(`M${i}`);
      await relate(viewer, m, 3);
      await relate(m, them, 3);
    }

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them, maxNodes: 10 });
    expect(map.nodes).toHaveLength(10);
    const set = ids(map);
    expect(set.has(them)).toBe(true);
    expect(set.has(viewer)).toBe(true);
  });

  it("lights the shortest path, so a direct edge outranks a stronger mutual", async () => {
    await relate(viewer, them, 1); // direct, avg 1 — but shortest
    const m = await mk("M");
    await relate(viewer, m, 4);
    await relate(m, them, 4); // mutual, avg 4 — stronger but a hop longer

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    expect(map.pathToViewer).toEqual([them, viewer]); // the direct edge, not the mutual
  });

  it("uses the direct edge as the path when that's the only connection", async () => {
    await relate(viewer, them, 3);

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    expect(ids(map)).toEqual(new Set([them, viewer]));
    expect(map.pathToViewer).toEqual([them, viewer]);
  });

  it("renders the viewer with no lit path when nothing connects you within two hops", async () => {
    const a = await mk("A");
    await relate(them, a, 3); // them's connection, but nothing reaches the viewer

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    expect(map.pathToViewer).toEqual([]);
    const set = ids(map);
    expect(set.has(viewer)).toBe(true);
    expect(set.has(them)).toBe(true);
    expect(set.has(a)).toBe(true);
  });

  it("prunes a hidden mutual from the map", async () => {
    const hidden = await mk("Hidden");
    await relate(viewer, hidden, 4);
    await relate(hidden, them, 4);
    await db.update(profiles).set({ hidden: true }).where(eq(profiles.id, hidden));

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    expect(ids(map).has(hidden)).toBe(false);
    expect(map.pathToViewer).toEqual([]); // the only bridge ran through the hidden node
  });

  it("returns every confirmed edge among the final node set", async () => {
    const x = await mk("X");
    await relate(viewer, x, 3);
    await relate(x, them, 4);

    const map = await getProfileMiniMap({ viewerId: viewer, profileId: them });
    expect(map.edges).toHaveLength(2);
    expect(map.edges.some((e) => e.relatorId === viewer && e.relateeId === x)).toBe(true);
    expect(map.edges.some((e) => e.relatorId === x && e.relateeId === them)).toBe(true);
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

  it("prunes a hidden node for non-admins and admins alike", async () => {
    await updateRelationValue({ relatorId: them, relateeId: hidden, value: 4 });
    await db.update(profiles).set({ hidden: true }).where(eq(profiles.id, hidden));

    authAs(viewer);
    const nonAdminBody = await (await app.request(`/api/relations/mini-map/${them}`)).json();
    expect(nonAdminBody.nodes.map((n: { id: string }) => n.id)).not.toContain(hidden);

    authAs(admin);
    const adminBody = await (await app.request(`/api/relations/mini-map/${them}`)).json();
    expect(adminBody.nodes.map((n: { id: string }) => n.id)).not.toContain(hidden);
  });
});
