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
import { profiles } from "@/server/schema";

const mockCreateServerClient = vi.mocked(createServerClient);

const makeUser = (id: string, email: string): User =>
  ({
    id,
    email,
    user_metadata: { displayName: "Test User" },
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  }) as User;

describe("GET /api/me", () => {
  let testUserId: string;

  beforeEach(async () => {
    testUserId = randomUUID();
    await db.execute(
      sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${testUserId}::uuid, 'me-test@testfake.local', false, false)`,
    );

    mockCreateServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: makeUser(testUserId, "me-test@testfake.local") },
          error: null,
        }),
      },
      // biome-ignore lint/suspicious/noExplicitAny: test mock shape
    } as any);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await db.delete(profiles).where(eq(profiles.id, testUserId));
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${testUserId}::uuid`);
  });

  const putMe = (body: unknown) =>
    app.request("/api/me", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("returns the self shape and self-heals a missing profile row", async () => {
    // No profile pre-inserted — handler must upsert on first call.
    const res = await app.request("/api/me");

    expect(res.status).toBe(200);
    const body = await res.json();

    // Strict equality: the self shape is explicit. Any accidental
    // field addition or omission will fail this assertion loudly.
    // Programs intentionally absent — they're not a profile field.
    expect(body).toEqual({
      id: testUserId,
      email: "me-test@testfake.local",
      profile: {
        id: testUserId,
        displayName: "Test User",
        bio: null,
        keywords: [],
        location: null,
        supplementaryInfo: null,
        referredBy: null,
        referredByLegacy: null,
        avatarUrl: null,
        emergencyContact: null,
        liveDesire: null,
        isAdmin: false,
        lastUpdatedWeb: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });

    // Confirm the self-heal actually wrote a row.
    const rows = await db.select().from(profiles).where(eq(profiles.id, testUserId));
    expect(rows).toHaveLength(1);
  });

  it("PUT /me updates allowed fields and returns the self shape", async () => {
    const res = await putMe({
      displayName: "Member Name",
      bio: "Hi, I'm a member.",
      keywords: ["curious", "writing"],
      location: "Lisbon",
      emergencyContact: "Alex · +351 999",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.displayName).toBe("Member Name");
    expect(body.profile.bio).toBe("Hi, I'm a member.");
    expect(body.profile.keywords).toEqual(["curious", "writing"]);
    expect(body.profile.location).toBe("Lisbon");
    expect(body.profile.emergencyContact).toBe("Alex · +351 999");

    // Untouched nullable fields remain null.
    expect(body.profile.avatarUrl).toBeNull();
    // isAdmin stays its default.
    expect(body.profile.isAdmin).toBe(false);
  });

  it.each([
    ["isAdmin", { isAdmin: true }],
    ["referredBy", { referredBy: "11111111-1111-1111-1111-111111111111" }],
    ["createdAt", { createdAt: "2026-01-01T00:00:00Z" }],
    ["id", { id: "11111111-1111-1111-1111-111111111111" }],
  ])("PUT /me rejects non-editable field: %s", async (_label, body) => {
    const res = await putMe(body);
    expect(res.status).toBe(400);

    // Confirm nothing leaked through: isAdmin stays false in DB.
    const [row] = await db.select().from(profiles).where(eq(profiles.id, testUserId));
    expect(row?.isAdmin ?? false).toBe(false);
  });

  it("PUT /me rejects keywords that are not an array of strings", async () => {
    const res = await putMe({ keywords: "not-an-array" });
    expect(res.status).toBe(400);

    const res2 = await putMe({ keywords: [1, 2, 3] });
    expect(res2.status).toBe(400);
  });

  it("PUT /me rejects malformed JSON body", async () => {
    const res = await app.request("/api/me", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/me/last-updated-web", () => {
  let testUserId: string;

  beforeEach(async () => {
    testUserId = randomUUID();
    await db.execute(
      sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${testUserId}::uuid, 'web-done-test@testfake.local', false, false)`,
    );
    await db.insert(profiles).values({ id: testUserId, displayName: "Done Tester" });

    mockCreateServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: makeUser(testUserId, "web-done-test@testfake.local") },
          error: null,
        }),
      },
      // biome-ignore lint/suspicious/noExplicitAny: test mock shape
    } as any);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await db.delete(profiles).where(eq(profiles.id, testUserId));
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${testUserId}::uuid`);
  });

  it("bumps lastUpdatedWeb to a new timestamp", async () => {
    const before = new Date();
    const res = await app.request("/api/me/last-updated-web", { method: "PUT" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [row] = await db.select().from(profiles).where(eq(profiles.id, testUserId));
    expect(row.lastUpdatedWeb).not.toBeNull();
    expect(row.lastUpdatedWeb?.getTime() ?? 0).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it("re-clicking Done bumps the timestamp forward", async () => {
    await app.request("/api/me/last-updated-web", { method: "PUT" });
    const [first] = await db.select().from(profiles).where(eq(profiles.id, testUserId));

    await new Promise((r) => setTimeout(r, 10));
    await app.request("/api/me/last-updated-web", { method: "PUT" });
    const [second] = await db.select().from(profiles).where(eq(profiles.id, testUserId));

    expect(second.lastUpdatedWeb?.getTime() ?? 0).toBeGreaterThan(first.lastUpdatedWeb?.getTime() ?? 0);
  });
});
