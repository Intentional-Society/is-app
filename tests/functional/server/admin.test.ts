import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";

import app from "@/server/api";
import { db } from "@/server/db";
import { profiles, relations } from "@/server/schema";

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

const authAs = (userId: string | null) => {
  mockCreateServerClient.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? fakeUser(userId) : null },
        error: null,
      }),
    },
    // biome-ignore lint/suspicious/noExplicitAny: test mock shape
  } as any);
};

const insertUserAndProfile = async (id: string, opts: { isAdmin?: boolean } = {}) => {
  await db.execute(
    sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${`${id}@testfake.local`}, false, false)`,
  );
  await db.insert(profiles).values({ id, isAdmin: opts.isAdmin ?? false });
};

const deleteUserAndProfile = async (id: string) => {
  await db.delete(profiles).where(eq(profiles.id, id));
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
};

describe("GET /api/admin/appsettings", () => {
  let admin: string;
  let nonAdmin: string;

  beforeEach(async () => {
    admin = randomUUID();
    nonAdmin = randomUUID();
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(nonAdmin);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(nonAdmin);
  });

  it("returns settings for an admin", async () => {
    authAs(admin);
    const res = await app.request("/api/admin/appsettings");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ appSettings: {} });
  });

  it("returns 404 for an authenticated non-admin", async () => {
    authAs(nonAdmin);
    const res = await app.request("/api/admin/appsettings");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 401 when no session is present", async () => {
    authAs(null);
    const res = await app.request("/api/admin/appsettings");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/admin/hints", () => {
  let admin: string;
  let nonAdmin: string;
  let other: string;

  beforeEach(async () => {
    admin = randomUUID();
    nonAdmin = randomUUID();
    other = randomUUID();
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(nonAdmin);
    await insertUserAndProfile(other);
    await db.update(profiles).set({ displayName: "Alex Admin" }).where(eq(profiles.id, admin));
    await db.update(profiles).set({ displayName: "Nora NonAdmin" }).where(eq(profiles.id, nonAdmin));
    await db.update(profiles).set({ displayName: "Otto Other" }).where(eq(profiles.id, other));
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await db
      .delete(relations)
      .where(sql`${relations.relatorId} IN (${nonAdmin}::uuid, ${admin}::uuid, ${other}::uuid)`);
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(nonAdmin);
    await deleteUserAndProfile(other);
  });

  it("returns pending hints with relator, relatee, and hintedBy enriched", async () => {
    await db.insert(relations).values({
      relatorId: nonAdmin,
      relateeId: other,
      value: null,
      isHint: true,
      hintedBy: admin,
    });

    authAs(admin);
    const res = await app.request("/api/admin/hints");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hints: Array<{ relator: { id: string }; relatee: { id: string }; hintedBy: { id: string } | null }>;
    };
    // The endpoint lists every pending hint in the DB, so other rows
    // (from parallel test files or stale local-dev state) may appear.
    // Filter to this test's seeded UUIDs before asserting.
    const own = body.hints.filter((h) => h.relator.id === nonAdmin && h.relatee.id === other);
    expect(own).toHaveLength(1);
    expect(own[0].hintedBy?.id).toBe(admin);
  });

  it("does not return confirmed (non-hint) rows", async () => {
    await db.insert(relations).values({
      relatorId: nonAdmin,
      relateeId: other,
      value: 3,
      isHint: false,
    });

    authAs(admin);
    const res = await app.request("/api/admin/hints");
    const body = (await res.json()) as { hints: Array<{ relator: { id: string }; relatee: { id: string } }> };
    // Same global-scope caveat: just assert the row this test inserted
    // is not surfaced, rather than asserting the whole list is empty.
    expect(body.hints.find((h) => h.relator.id === nonAdmin && h.relatee.id === other)).toBeUndefined();
  });

  it("returns 404 for non-admins", async () => {
    authAs(nonAdmin);
    const res = await app.request("/api/admin/hints");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/admin/profiles/:id", () => {
  let admin: string;
  let nonAdmin: string;
  let target: string;

  beforeEach(async () => {
    admin = randomUUID();
    nonAdmin = randomUUID();
    target = randomUUID();
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(nonAdmin);
    await insertUserAndProfile(target);
    await db.update(profiles).set({ displayName: "Target" }).where(eq(profiles.id, target));
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(nonAdmin);
    await deleteUserAndProfile(target);
  });

  it("hides and unhides a profile when called by an admin", async () => {
    authAs(admin);
    const hide = await app.request(`/api/admin/profiles/${target}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: true }),
    });
    expect(hide.status).toBe(200);
    const [hidden] = await db.select({ hidden: profiles.hidden }).from(profiles).where(eq(profiles.id, target));
    expect(hidden.hidden).toBe(true);

    const unhide = await app.request(`/api/admin/profiles/${target}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: false }),
    });
    expect(unhide.status).toBe(200);
    const [unhidden] = await db.select({ hidden: profiles.hidden }).from(profiles).where(eq(profiles.id, target));
    expect(unhidden.hidden).toBe(false);
  });

  it("returns 400 when body is not { hidden: boolean }", async () => {
    authAs(admin);
    const res = await app.request(`/api/admin/profiles/${target}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: "true" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-admins", async () => {
    authAs(nonAdmin);
    const res = await app.request(`/api/admin/profiles/${target}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: true }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-existent profile id", async () => {
    authAs(admin);
    const res = await app.request(`/api/admin/profiles/${randomUUID()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: true }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/profiles/hidden", () => {
  let admin: string;
  let nonAdmin: string;
  let hidden: string;

  beforeEach(async () => {
    admin = randomUUID();
    nonAdmin = randomUUID();
    hidden = randomUUID();
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(nonAdmin);
    await insertUserAndProfile(hidden);
    await db.update(profiles).set({ displayName: "Hidden Test", hidden: true }).where(eq(profiles.id, hidden));
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(nonAdmin);
    await deleteUserAndProfile(hidden);
  });

  it("returns the hidden profile for admins", async () => {
    authAs(admin);
    const res = await app.request("/api/admin/profiles/hidden");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: Array<{ id: string }> };
    expect(body.members.find((m) => m.id === hidden)).toBeDefined();
  });

  it("returns 404 for non-admins", async () => {
    authAs(nonAdmin);
    const res = await app.request("/api/admin/profiles/hidden");
    expect(res.status).toBe(404);
  });
});
