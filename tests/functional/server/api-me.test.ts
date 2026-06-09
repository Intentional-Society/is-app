import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

// Stub the privileged client so PUT /me's auth.users metadata sync is
// observable without a real GoTrue round-trip (the test users are raw
// SQL inserts, not GoTrue-created accounts).
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: { admin: { updateUserById: vi.fn().mockResolvedValue({ data: {}, error: null }) } },
  },
}));

// The metadata sync swallows GoTrue failures to Sentry; mock it so the
// best-effort path is observable and silent.
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { createServerClient } from "@supabase/ssr";

import { toSlug } from "@/lib/slug";
import { supabaseAdmin } from "@/lib/supabase/admin";
import app from "@/server/api";
import { db } from "@/server/db";
import { profiles } from "@/server/schema";

const mockCreateServerClient = vi.mocked(createServerClient);
const mockUpdateUserById = vi.mocked(supabaseAdmin.auth.admin.updateUserById);
const mockCaptureException = vi.mocked(Sentry.captureException);

// Unique per run: upsertProfile derives the profile slug via toSlug,
// which hits a global unique constraint, and parallel test files share
// one DB — a fixed "Test User" collides with profiles.test.ts.
const TEST_DISPLAY_NAME = `Test User ${randomUUID().slice(0, 8)}`;

const makeUser = (id: string, email: string): User =>
  ({
    id,
    email,
    user_metadata: { displayName: TEST_DISPLAY_NAME },
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  }) as User;

describe("GET /api/me", () => {
  let testUserId: string;

  beforeEach(async () => {
    testUserId = randomUUID();
    mockUpdateUserById.mockClear();
    mockCaptureException.mockClear();
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
        displayName: TEST_DISPLAY_NAME,
        slug: toSlug(TEST_DISPLAY_NAME),
        bio: null,
        keywords: [],
        location: null,
        supplementaryInfo: null,
        referredBy: null,
        referredByLegacy: null,
        avatarUrl: null,
        emergencyContact: null,
        currentIntention: null,
        intentionUpdatedAt: null,
        deactivatedAt: null,
        isAdmin: false,
        lastSignedAgreements: null,
        lastUpdatedProfile: null,
        lastReviewedPrograms: null,
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

  it("PUT /me de-duplicates keywords on save", async () => {
    const res = await putMe({ keywords: ["running", "running", "yoga", "yoga", "running"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: { keywords: string[] } };
    expect(body.profile.keywords).toEqual(["running", "yoga"]);
  });

  it("PUT /me rejects malformed JSON body", async () => {
    const res = await app.request("/api/me", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  // Slugs are stable once set (#188): renames and clears must not move
  // a member's profile URL out from under previously shared links.
  it.each([
    ["changes", { displayName: "Renamed Member" }],
    ["is cleared", { displayName: null }],
  ])("PUT /me keeps the existing slug when displayName %s", async (_label, body) => {
    // Self-heal creates the profile with the metadata-derived slug.
    await app.request("/api/me");

    const res = await putMe(body);
    expect(res.status).toBe(200);
    expect((await res.json()).profile.slug).toBe(toSlug(TEST_DISPLAY_NAME));
  });

  it("PUT /me backfills a null slug from the displayName", async () => {
    await db.insert(profiles).values({ id: testUserId, displayName: null, slug: null });

    const res = await putMe({ displayName: `Backfilled ${TEST_DISPLAY_NAME}` });
    expect(res.status).toBe(200);
    expect((await res.json()).profile.slug).toBe(toSlug(`Backfilled ${TEST_DISPLAY_NAME}`));
  });

  // Display names may repeat; only the URL is unique. A derived-slug
  // clash permutes (-2, then increments) so a name twin still gets a
  // readable URL.
  it.each([
    ["second member gets -2", [""], "-2"],
    ["third member increments past -2", ["", "-2"], "-3"],
  ])("PUT /me permutes a taken derived slug: %s", async (_label, takenSuffixes, expectedSuffix) => {
    const base = toSlug(TEST_DISPLAY_NAME);
    const otherIds: string[] = [];
    for (const suffix of takenSuffixes) {
      const otherId = randomUUID();
      otherIds.push(otherId);
      await db.execute(
        sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${otherId}::uuid, ${`slug-clash-${otherId}@testfake.local`}, false, false)`,
      );
      await db.insert(profiles).values({ id: otherId, displayName: TEST_DISPLAY_NAME, slug: `${base}${suffix}` });
    }
    await db.insert(profiles).values({ id: testUserId, displayName: null, slug: null });

    try {
      const res = await putMe({ displayName: TEST_DISPLAY_NAME });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.profile.displayName).toBe(TEST_DISPLAY_NAME);
      expect(body.profile.slug).toBe(`${base}${expectedSuffix}`);
    } finally {
      for (const otherId of otherIds) {
        await db.delete(profiles).where(eq(profiles.id, otherId));
        await db.execute(sql`DELETE FROM auth.users WHERE id = ${otherId}::uuid`);
      }
    }
  });

  it("PUT /me sets an explicitly chosen slug, normalized", async () => {
    await app.request("/api/me");

    const res = await putMe({ slug: `My Custom URL ${testUserId.slice(0, 8)}!` });
    expect(res.status).toBe(200);
    expect((await res.json()).profile.slug).toBe(`my-custom-url-${testUserId.slice(0, 8)}`);
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["punctuation-only", "!!!"],
  ])("PUT /me rejects an invalid slug: %s", async (_label, slug) => {
    const res = await putMe({ slug });
    expect(res.status).toBe(400);
  });

  it("PUT /me returns 409 when an explicitly chosen slug is already taken", async () => {
    const otherId = randomUUID();
    const takenSlug = `taken-${otherId.slice(0, 8)}`;
    await db.execute(
      sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${otherId}::uuid, 'slug-409@testfake.local', false, false)`,
    );
    await db.insert(profiles).values({ id: otherId, displayName: "Slug Owner", slug: takenSlug });

    try {
      const res = await putMe({ slug: takenSlug });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/already taken/i);

      // The failed update must leave the caller's own slug untouched.
      const [row] = await db.select().from(profiles).where(eq(profiles.id, testUserId));
      expect(row?.slug).not.toBe(takenSlug);
    } finally {
      await db.delete(profiles).where(eq(profiles.id, otherId));
      await db.execute(sql`DELETE FROM auth.users WHERE id = ${otherId}::uuid`);
    }
  });

  it("PUT /me mirrors a displayName edit into auth.users.user_metadata", async () => {
    // A user whose metadata carries GoTrue-managed fields alongside the
    // name, so we can prove the sync preserves them.
    mockCreateServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              ...makeUser(testUserId, "me-test@testfake.local"),
              user_metadata: { displayName: "Old Name", email_verified: true, sub: testUserId },
            },
          },
          error: null,
        }),
      },
      // biome-ignore lint/suspicious/noExplicitAny: test mock shape
    } as any);

    const res = await putMe({ displayName: "Fresh Name" });
    expect(res.status).toBe(200);

    expect(mockUpdateUserById).toHaveBeenCalledTimes(1);
    expect(mockUpdateUserById).toHaveBeenCalledWith(testUserId, {
      // GoTrue-managed fields survive; only displayName changes.
      user_metadata: { displayName: "Fresh Name", email_verified: true, sub: testUserId },
    });
  });

  it("PUT /me clears the metadata displayName when set to null", async () => {
    const res = await putMe({ displayName: null });
    expect(res.status).toBe(200);
    expect(mockUpdateUserById).toHaveBeenCalledWith(testUserId, {
      user_metadata: { displayName: null },
    });
  });

  it("PUT /me does not touch auth metadata when displayName is absent", async () => {
    const res = await putMe({ bio: "Edited my bio, not my name." });
    expect(res.status).toBe(200);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it("PUT /me still succeeds (and captures) when the metadata sync fails", async () => {
    // GoTrue returns an error: the profile write already committed, so the
    // request must still succeed — the greeting just stays stale until the
    // next edit, and the failure is captured rather than thrown.
    mockUpdateUserById.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "gotrue down" },
      // biome-ignore lint/suspicious/noExplicitAny: partial admin error shape
    } as any);

    const res = await putMe({ displayName: "Resilient Name" });
    expect(res.status).toBe(200);
    expect((await res.json()).profile.displayName).toBe("Resilient Name");
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
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

describe("PUT /api/me welcome-step markers", () => {
  let testUserId: string;

  beforeEach(async () => {
    testUserId = randomUUID();
    await db.execute(
      sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${testUserId}::uuid, 'welcome-marker-test@testfake.local', false, false)`,
    );
    await db.insert(profiles).values({ id: testUserId, displayName: "Marker Tester" });

    mockCreateServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: makeUser(testUserId, "welcome-marker-test@testfake.local") },
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

  it.each([
    ["/api/me/last-signed-agreements", "lastSignedAgreements"],
    ["/api/me/last-reviewed-programs", "lastReviewedPrograms"],
  ] as const)("PUT %s stamps %s on the profile", async (path, column) => {
    const before = new Date();
    const res = await app.request(path, { method: "PUT" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [row] = await db.select().from(profiles).where(eq(profiles.id, testUserId));
    const stamped = row[column];
    expect(stamped).not.toBeNull();
    expect(stamped?.getTime() ?? 0).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });
});

describe("POST /api/me/deactivate and /api/me/reactivate", () => {
  let testUserId: string;

  beforeEach(async () => {
    testUserId = randomUUID();
    await db.execute(
      sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${testUserId}::uuid, 'deactivate-test@testfake.local', false, false)`,
    );
    mockCreateServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: makeUser(testUserId, "deactivate-test@testfake.local") },
          error: null,
        }),
      },
      // biome-ignore lint/suspicious/noExplicitAny: test mock shape
    } as any);
    // Ensure profile row exists.
    await app.request("/api/me");
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await db.delete(profiles).where(eq(profiles.id, testUserId));
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${testUserId}::uuid`);
  });

  it("POST /api/me/deactivate sets deactivated_at", async () => {
    const before = new Date();
    const res = await app.request("/api/me/deactivate", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [row] = await db.select().from(profiles).where(eq(profiles.id, testUserId));
    expect(row.deactivatedAt).not.toBeNull();
    expect(row.deactivatedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it("POST /api/me/reactivate clears deactivated_at", async () => {
    // Deactivate first.
    await app.request("/api/me/deactivate", { method: "POST" });
    const [before] = await db.select().from(profiles).where(eq(profiles.id, testUserId));
    expect(before.deactivatedAt).not.toBeNull();

    // Now reactivate.
    const res = await app.request("/api/me/reactivate", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [after] = await db.select().from(profiles).where(eq(profiles.id, testUserId));
    expect(after.deactivatedAt).toBeNull();
  });

  it("GET /me exposes deactivatedAt after deactivation", async () => {
    await app.request("/api/me/deactivate", { method: "POST" });
    const res = await app.request("/api/me");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.deactivatedAt).not.toBeNull();
  });
});

describe("PUT /api/me intention timestamp", () => {
  let testUserId: string;
  // A clearly-historical timestamp so "did it move to now()?" is unambiguous.
  const OLD = new Date("2020-01-01T00:00:00.000Z");

  beforeEach(async () => {
    testUserId = randomUUID();
    await db.execute(
      sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${testUserId}::uuid, 'intention-test@testfake.local', false, false)`,
    );

    mockCreateServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: makeUser(testUserId, "intention-test@testfake.local") },
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

  const readRow = async () => {
    const [row] = await db.select().from(profiles).where(eq(profiles.id, testUserId));
    return row;
  };

  it("stamps intentionUpdatedAt when an intention is first set", async () => {
    await db.insert(profiles).values({ id: testUserId, displayName: "Intent Tester" });
    const before = new Date();

    const res = await putMe({ currentIntention: "Ship the intentions cloud" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.currentIntention).toBe("Ship the intentions cloud");
    expect(body.profile.intentionUpdatedAt).not.toBeNull();

    const row = await readRow();
    expect(row.intentionUpdatedAt?.getTime() ?? 0).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it("re-stamps intentionUpdatedAt when the intention text changes", async () => {
    await db.insert(profiles).values({
      id: testUserId,
      displayName: "Intent Tester",
      currentIntention: "Old intention",
      intentionUpdatedAt: OLD,
    });
    const before = new Date();

    const res = await putMe({ currentIntention: "New intention" });
    expect(res.status).toBe(200);

    const row = await readRow();
    expect(row.currentIntention).toBe("New intention");
    expect(row.intentionUpdatedAt?.getTime() ?? 0).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(row.intentionUpdatedAt?.getTime()).not.toBe(OLD.getTime());
  });

  it("leaves intentionUpdatedAt untouched when an unrelated field is edited", async () => {
    await db.insert(profiles).values({
      id: testUserId,
      displayName: "Intent Tester",
      currentIntention: "Steady intention",
      intentionUpdatedAt: OLD,
    });

    const res = await putMe({ bio: "Just updating my bio." });
    expect(res.status).toBe(200);

    const row = await readRow();
    expect(row.bio).toBe("Just updating my bio.");
    // The whole point of the conditional stamp: the /intentions cloud
    // orders "freshest on top" by intentionUpdatedAt, so editing a bio
    // (or any other field) must not float a stale intention to the top.
    expect(row.intentionUpdatedAt?.getTime()).toBe(OLD.getTime());
  });

  it("does not re-stamp when the same intention text is submitted again", async () => {
    await db.insert(profiles).values({
      id: testUserId,
      displayName: "Intent Tester",
      currentIntention: "Same intention",
      intentionUpdatedAt: OLD,
    });

    const res = await putMe({ currentIntention: "Same intention" });
    expect(res.status).toBe(200);

    const row = await readRow();
    expect(row.intentionUpdatedAt?.getTime()).toBe(OLD.getTime());
  });
});
