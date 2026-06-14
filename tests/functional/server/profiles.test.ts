import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toSlug } from "@/lib/slug";
import { db } from "@/server/db";
import {
  getProfileForAdmin,
  getProfileForMember,
  getProfileForSelf,
  listHiddenMembers,
  listMembers,
  setProfileHidden,
  upsertProfile,
  withSlugPermutation,
} from "@/server/profiles";
import { profiles } from "@/server/schema";

// Unique per run: toSlug(displayName) feeds the global profiles slug
// unique constraint, and parallel test files share one DB — a fixed
// "Test User" collides with api-me.test.ts on the derived slug. The
// trailing letter keeps the slug from ending in digits: nextSlug
// increments a trailing number ("…-639" → "…-640") instead of
// appending the -2 these tests assert.
const TEST_DISPLAY_NAME = `Test User ${randomUUID().slice(0, 8)}z`;

describe("upsertProfile", () => {
  let testUserId: string;

  beforeEach(async () => {
    testUserId = randomUUID();
    // auth.users owns the FK target; insert a minimal row so the
    // profiles FK constraint is satisfied. is_sso_user / is_anonymous
    // are NOT NULL in Supabase's schema even though they have defaults.
    await db.execute(
      sql`INSERT INTO auth.users (id, is_sso_user, is_anonymous) VALUES (${testUserId}::uuid, false, false)`,
    );
  });

  afterEach(async () => {
    await db.delete(profiles).where(eq(profiles.id, testUserId));
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${testUserId}::uuid`);
  });

  it("is idempotent across repeated calls for the same user", async () => {
    const user = {
      id: testUserId,
      user_metadata: { displayName: TEST_DISPLAY_NAME },
      app_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00Z",
    } as User;

    await upsertProfile(user);
    await upsertProfile(user);

    const rows = await db.select().from(profiles).where(eq(profiles.id, testUserId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayName).toBe(TEST_DISPLAY_NAME);
  });

  it("reports created=true on first call and created=false thereafter", async () => {
    const user = {
      id: testUserId,
      user_metadata: { displayName: TEST_DISPLAY_NAME },
      app_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00Z",
    } as User;

    const first = await upsertProfile(user);
    const second = await upsertProfile(user);

    expect(first).toEqual({ created: true });
    expect(second).toEqual({ created: false });
  });

  it("stores a null displayName when user_metadata is empty", async () => {
    const user = {
      id: testUserId,
      user_metadata: {},
      app_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00Z",
    } as User;

    await upsertProfile(user);

    const rows = await db.select().from(profiles).where(eq(profiles.id, testUserId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayName).toBeNull();
  });

  it("permutes the slug when the derived slug is already taken", async () => {
    // A sign-in must not break on a display-name twin (#188) — the
    // newcomer gets the next free permutation of the shared name.
    const otherId = randomUUID();
    await db.execute(
      sql`INSERT INTO auth.users (id, is_sso_user, is_anonymous) VALUES (${otherId}::uuid, false, false)`,
    );
    await db.insert(profiles).values({ id: otherId, displayName: TEST_DISPLAY_NAME, slug: toSlug(TEST_DISPLAY_NAME) });

    try {
      const user = {
        id: testUserId,
        user_metadata: { displayName: TEST_DISPLAY_NAME },
        app_metadata: {},
        aud: "authenticated",
        created_at: "2026-01-01T00:00:00Z",
      } as User;

      expect(await upsertProfile(user)).toEqual({ created: true });

      const rows = await db.select().from(profiles).where(eq(profiles.id, testUserId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.displayName).toBe(TEST_DISPLAY_NAME);
      expect(rows[0]?.slug).toBe(`${toSlug(TEST_DISPLAY_NAME)}-2`);
    } finally {
      await db.delete(profiles).where(eq(profiles.id, otherId));
      await db.execute(sql`DELETE FROM auth.users WHERE id = ${otherId}::uuid`);
    }
  });
});

describe("withSlugPermutation", () => {
  // A write that fails with a slug-unique violation for every slug in
  // `taken`, recording what it was asked to write.
  const fakeWrite = (taken: string[], calls: (string | null)[]) => async (slug: string | null) => {
    calls.push(slug);
    if (slug !== null && taken.includes(slug)) {
      throw Object.assign(new Error("duplicate key"), {
        cause: { code: "23505", constraint_name: "profiles_slug_unique" },
      });
    }
    return slug;
  };

  it("writes a null slug when the input normalizes to nothing", async () => {
    // Permuting "" would make "-2" the member's whole URL.
    const calls: (string | null)[] = [];
    expect(await withSlugPermutation("", fakeWrite([], calls))).toBeNull();
    expect(calls).toEqual([null]);
  });

  it("permutes through taken slugs to the first free one", async () => {
    const calls: (string | null)[] = [];
    expect(await withSlugPermutation("aria-chen", fakeWrite(["aria-chen", "aria-chen-2"], calls))).toBe("aria-chen-3");
    expect(calls).toEqual(["aria-chen", "aria-chen-2", "aria-chen-3"]);
  });

  it("falls back to a null slug when every permutation is taken", async () => {
    const taken = ["aria-chen", ...Array.from({ length: 20 }, (_, i) => `aria-chen-${i + 2}`)];
    const calls: (string | null)[] = [];
    expect(await withSlugPermutation("aria-chen", fakeWrite(taken, calls))).toBeNull();
    expect(calls.at(-1)).toBeNull();
  });

  it("rethrows non-slug-clash errors", async () => {
    await expect(
      withSlugPermutation("aria-chen", async () => {
        throw new Error("connection lost");
      }),
    ).rejects.toThrow("connection lost");
  });
});

describe("getProfileForSelf", () => {
  let testUserId: string;

  beforeEach(async () => {
    testUserId = randomUUID();
    await db.execute(
      sql`INSERT INTO auth.users (id, is_sso_user, is_anonymous) VALUES (${testUserId}::uuid, false, false)`,
    );
    await db.insert(profiles).values({ id: testUserId, displayName: "Me" });
  });

  afterEach(async () => {
    await db.delete(profiles).where(eq(profiles.id, testUserId));
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${testUserId}::uuid`);
  });

  it("returns null for an unknown id", async () => {
    expect(await getProfileForSelf(randomUUID())).toBeNull();
  });

  it("returns the full self shape, including emergencyContact and isAdmin", async () => {
    const profile = await getProfileForSelf(testUserId);

    // Explicit key list guards against accidental field removal during
    // future refactors and locks in emergencyContact visibility for
    // self. Programs are deliberately NOT a profile field.
    expect(profile).not.toBeNull();
    expect(Object.keys(profile ?? {}).sort()).toEqual(
      [
        "id",
        "displayName",
        "slug",
        "bio",
        "keywords",
        "location",
        "supplementaryInfo",
        "referredBy",
        "referredByLegacy",
        "avatarUrl",
        "emergencyContact",
        "currentIntention",
        "intentionUpdatedAt",
        "deactivatedAt",
        "hasPassword",
        "isAdmin",
        "hidden",
        "lastSignedAgreements",
        "lastUpdatedProfile",
        "lastReviewedPrograms",
        "lastUpdatedWeb",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
  });
});

describe("getProfileForMember", () => {
  let memberId: string;

  beforeEach(async () => {
    memberId = randomUUID();
    await db.execute(
      sql`INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at, is_sso_user, is_anonymous, confirmation_token, recovery_token, email_change_token_new, email_change)
          VALUES (${memberId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', ${`member-${memberId}@test.local`}, now(), now(), now(), false, false, '', '', '', '')`,
    );
    await db.insert(profiles).values({ id: memberId, displayName: "Test Member", bio: "Hello" });
  });

  afterEach(async () => {
    await db.delete(profiles).where(eq(profiles.id, memberId));
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${memberId}::uuid`);
  });

  it("returns public fields for an existing member", async () => {
    const profile = await getProfileForMember(memberId);
    expect(profile).not.toBeNull();
    expect(profile?.displayName).toBe("Test Member");
    expect(Object.keys(profile ?? {}).sort()).toEqual(
      [
        "id",
        "slug",
        "displayName",
        "bio",
        "keywords",
        "location",
        "supplementaryInfo",
        "avatarUrl",
        "email",
        "currentIntention",
        "intentionUpdatedAt",
        "createdAt",
      ].sort(),
    );
  });

  it("does not include emergencyContact or isAdmin", async () => {
    const profile = await getProfileForMember(memberId);
    expect(profile).not.toHaveProperty("emergencyContact");
    expect(profile).not.toHaveProperty("isAdmin");
  });

  it("returns null for an unknown id", async () => {
    const profile = await getProfileForMember(randomUUID());
    expect(profile).toBeNull();
  });
});

describe("getProfileForAdmin stub", () => {
  it("getProfileForAdmin throws NotImplemented", async () => {
    await expect(getProfileForAdmin()).rejects.toThrow(/NotImplemented/);
  });
});

describe("profiles.hidden", () => {
  let visibleId: string;
  let hiddenId: string;

  beforeEach(async () => {
    visibleId = randomUUID();
    hiddenId = randomUUID();
    for (const id of [visibleId, hiddenId]) {
      await db.execute(sql`INSERT INTO auth.users (id, is_sso_user, is_anonymous) VALUES (${id}::uuid, false, false)`);
    }
    await db.insert(profiles).values({ id: visibleId, displayName: "Visible Vera", bio: "Here to be seen" });
    await db.insert(profiles).values({ id: hiddenId, displayName: "Hidden Henry", hidden: true });
  });

  afterEach(async () => {
    for (const id of [visibleId, hiddenId]) {
      await db.delete(profiles).where(eq(profiles.id, id));
      await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
    }
  });

  it("defaults to false on insert", async () => {
    const [row] = await db.select({ hidden: profiles.hidden }).from(profiles).where(eq(profiles.id, visibleId));
    expect(row.hidden).toBe(false);
  });

  it("getProfileForSelf surfaces hidden, so /me can tell the member", async () => {
    const profile = await getProfileForSelf(hiddenId);
    expect(profile?.hidden).toBe(true);
  });

  it("listMembers excludes hidden by default and includes when includeHidden=true", async () => {
    const visible = await listMembers();
    expect(visible.find((m) => m.id === hiddenId)).toBeUndefined();
    expect(visible.find((m) => m.id === visibleId)).toBeDefined();

    const all = await listMembers({ includeHidden: true });
    expect(all.find((m) => m.id === hiddenId)).toBeDefined();
  });

  it("getProfileForMember returns null for hidden by default; returns the row when includeHidden=true", async () => {
    expect(await getProfileForMember(hiddenId)).toBeNull();
    const admin = await getProfileForMember(hiddenId, { includeHidden: true });
    expect(admin?.id).toBe(hiddenId);
  });

  it("listHiddenMembers returns only hidden profiles", async () => {
    const rows = await listHiddenMembers();
    expect(rows.find((m) => m.id === hiddenId)).toBeDefined();
    expect(rows.find((m) => m.id === visibleId)).toBeUndefined();
  });

  it("setProfileHidden flips the flag both ways and 404s for unknown ids", async () => {
    expect(await setProfileHidden({ profileId: visibleId, hidden: true })).toEqual({ ok: true });
    expect(await getProfileForMember(visibleId)).toBeNull();
    expect(await setProfileHidden({ profileId: visibleId, hidden: false })).toEqual({ ok: true });
    expect(await getProfileForMember(visibleId)).not.toBeNull();
    expect(await setProfileHidden({ profileId: randomUUID(), hidden: true })).toEqual({ error: "not_found" });
  });
});

describe("directory onboarding gate", () => {
  let pendingId: string;

  beforeEach(async () => {
    pendingId = randomUUID();
    await db.execute(
      sql`INSERT INTO auth.users (id, is_sso_user, is_anonymous) VALUES (${pendingId}::uuid, false, false)`,
    );
    // The state an invite signup is in before the welcome profile step:
    // displayName from auth metadata, no bio yet.
    await db.insert(profiles).values({ id: pendingId, displayName: "Pending Pete" });
  });

  afterEach(async () => {
    await db.delete(profiles).where(eq(profiles.id, pendingId));
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${pendingId}::uuid`);
  });

  it("listMembers omits a member who has not set up their profile yet", async () => {
    const visible = await listMembers();
    expect(visible.find((m) => m.id === pendingId)).toBeUndefined();
  });

  it("admins still see mid-onboarding members via includeHidden", async () => {
    const all = await listMembers({ includeHidden: true });
    expect(all.find((m) => m.id === pendingId)).toBeDefined();
  });

  it("a saved bio makes the member visible (whitespace alone does not)", async () => {
    await db.update(profiles).set({ bio: "   " }).where(eq(profiles.id, pendingId));
    expect((await listMembers()).find((m) => m.id === pendingId)).toBeUndefined();

    await db.update(profiles).set({ bio: "Hello, I exist now" }).where(eq(profiles.id, pendingId));
    expect((await listMembers()).find((m) => m.id === pendingId)).toBeDefined();
  });
});
