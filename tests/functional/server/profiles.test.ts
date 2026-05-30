import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import {
  getProfileForAdmin,
  getProfileForMember,
  getProfileForSelf,
  listHiddenMembers,
  listMembers,
  setProfileHidden,
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
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${testUserId}::uuid`);
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

    const rows = await db.select().from(profiles).where(eq(profiles.id, testUserId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayName).toBe("Test User");
  });

  it("reports created=true on first call and created=false thereafter", async () => {
    const user = {
      id: testUserId,
      user_metadata: { displayName: "Test User" },
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
        "bio",
        "keywords",
        "location",
        "supplementaryInfo",
        "referredBy",
        "referredByLegacy",
        "avatarUrl",
        "emergencyContact",
        "liveDesire",
        "currentIntention",
        "intentionUpdatedAt",
        "deactivatedAt",
        "isAdmin",
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
        "liveDesire",
        "email",
        "currentIntention",
        "intentionUpdatedAt",
        "deactivatedAt",
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
    await db.insert(profiles).values({ id: visibleId, displayName: "Visible Vera" });
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
