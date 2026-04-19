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

describe("getProfileForMember / getProfileForAdmin stubs", () => {
  it("getProfileForMember throws NotImplemented", async () => {
    await expect(getProfileForMember(randomUUID())).rejects.toThrow(
      /NotImplemented/,
    );
  });

  it("getProfileForAdmin throws NotImplemented", async () => {
    await expect(getProfileForAdmin(randomUUID())).rejects.toThrow(
      /NotImplemented/,
    );
  });
});
