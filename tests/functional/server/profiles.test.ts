import { randomUUID } from "node:crypto";

import type { User } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import {
  getProfileForAdmin,
  getProfileForMember,
  getProfileForSelf,
  upsertProfile,
} from "@/server/profiles";
import { profiles } from "@/server/schema";

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
    await db.execute(
      sql`DELETE FROM auth.users WHERE id = ${testUserId}::uuid`,
    );
  });

  it("is idempotent across repeated calls for the same user", async () => {
    const user = {
      id: testUserId,
      user_metadata: { displayName: "Test User" },
      app_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00Z",
    } as User;

    await upsertProfile(user);
    await upsertProfile(user);

    const rows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, testUserId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayName).toBe("Test User");
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

    const rows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, testUserId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayName).toBeNull();
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
    await db.execute(
      sql`DELETE FROM auth.users WHERE id = ${testUserId}::uuid`,
    );
  });

  it("returns null for an unknown id", async () => {
    expect(await getProfileForSelf(randomUUID())).toBeNull();
  });

  // Skipped: getProfileForSelf is wrapped in React.cache() so the root
  // layout (header displayName) and `/` (bio-null /welcome redirect)
  // share one DB roundtrip per request. cache()'s dedup only activates
  // inside an active RSC render or Next.js server-request scope —
  // vitest doesn't set that up, so the wrapper is a no-op here and
  // both awaits hit the DB independently. Verified instead by the
  // Playwright e2e suite running against a real Vercel preview.
  it.skip("memoizes per request — same userId returns the same reference", async () => {
    const a = await getProfileForSelf(testUserId);
    const b = await getProfileForSelf(testUserId);
    expect(b).toBe(a);
  });

  it("returns the full self shape, including emergencyContact and isAdmin", async () => {
    const profile = await getProfileForSelf(testUserId);

    // Explicit key list guards against accidental field removal during
    // future refactors and locks in emergencyContact visibility for
    // self. Programs are deliberately NOT a profile field.
    expect(profile).not.toBeNull();
    expect(Object.keys(profile!).sort()).toEqual(
      [
        "id",
        "displayName",
        "bio",
        "keywords",
        "location",
        "supplementaryInfo",
        "referredBy",
        "referredByLegacy",
        "avatarUrl",
        "emergencyContact",
        "liveDesire",
        "isAdmin",
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
    expect(Object.keys(profile!).sort()).toEqual(
      ["id", "slug", "displayName", "bio", "keywords", "location", "supplementaryInfo", "avatarUrl", "liveDesire", "createdAt"].sort(),
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
