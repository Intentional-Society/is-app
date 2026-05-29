import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { GET } from "@/app/auth/callback/route";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/server/db";
import { createInvite } from "@/server/invites";
import { invites, profilePrograms, profiles, programs } from "@/server/schema";

const mockCreateClient = vi.mocked(createClient);

const makeRequest = (path: string) => new NextRequest(new URL(path, "http://testfake.local"));

const mockSupabase = (user: { id: string; email: string } | null) => {
  const signOut = vi.fn().mockResolvedValue({ error: null });
  mockCreateClient.mockResolvedValue({
    auth: {
      verifyOtp: vi.fn().mockResolvedValue({
        data: user
          ? {
              user: {
                id: user.id,
                email: user.email,
                user_metadata: { displayName: "New Member" },
                app_metadata: {},
                aud: "authenticated",
                created_at: "2026-01-01T00:00:00Z",
              },
              session: { access_token: "x", refresh_token: "y" },
            }
          : { user: null, session: null },
        error: user ? null : { message: "expired", status: 400 },
      }),
      signOut,
    },
    // biome-ignore lint/suspicious/noExplicitAny: test mock shape
  } as any);
  return { signOut };
};

const insertAuthUser = async (id: string, email: string) => {
  await db.execute(
    sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${email}, false, false)`,
  );
};

const deleteAuthUser = async (id: string) => {
  await db.delete(profiles).where(eq(profiles.id, id));
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
};

// The auto-subscribe target's slug is fixed in the production code, so
// concurrent tests would otherwise race on inserting/deleting the same
// row. Upsert with ON CONFLICT DO NOTHING and never delete — the slug
// has a unique constraint, so there's only ever one row, and leaving
// it across tests is harmless.
const ensureWeeklyProgram = async (): Promise<string> => {
  await db
    .insert(programs)
    .values({
      slug: "weekly-web-updates",
      name: "Weekly Web Updates",
      description: "Auto-subscribe target (test-managed).",
    })
    .onConflictDoNothing({ target: programs.slug });
  const [row] = await db.select({ id: programs.id }).from(programs).where(eq(programs.slug, "weekly-web-updates"));
  return row.id;
};

describe("GET /auth/callback", () => {
  beforeEach(() => {
    mockCreateClient.mockReset();
  });

  it("redirects to /signin?error=missing_token when the token_hash query param is absent", async () => {
    const res = await GET(makeRequest("/auth/callback?type=email"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://testfake.local/signin?error=missing_token");
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("redirects to /signin?error=missing_token when the type query param is absent", async () => {
    const res = await GET(makeRequest("/auth/callback?token_hash=abc"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://testfake.local/signin?error=missing_token");
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("redirects to /signin?error=missing_token when type is not one we handle", async () => {
    // `signup` is a valid EmailOtpType in the Supabase SDK but our
    // templates never emit it — the runtime guard rejects it before we
    // ever call verifyOtp.
    const res = await GET(makeRequest("/auth/callback?token_hash=abc&type=signup"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://testfake.local/signin?error=missing_token");
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("redirects to /signin?error=verify_failed when verifyOtp errors", async () => {
    mockSupabase(null);

    const res = await GET(makeRequest("/auth/callback?token_hash=bad&type=email"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://testfake.local/signin?error=verify_failed");
  });

  it("redirects recovery flows to /auth/reset-password without touching the profile", async () => {
    const userId = randomUUID();
    await insertAuthUser(userId, `${userId}@testfake.local`);
    mockSupabase({ id: userId, email: `${userId}@testfake.local` });

    try {
      const res = await GET(makeRequest("/auth/callback?token_hash=hash&type=recovery"));

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://testfake.local/auth/reset-password");

      // No profile row created — recovery branch skips that step.
      const rows = await db.select().from(profiles).where(eq(profiles.id, userId));
      expect(rows).toHaveLength(0);
    } finally {
      await deleteAuthUser(userId);
    }
  });
});

describe("GET /auth/callback (ordinary sign-in, auto-subscribe to weekly-web-updates)", () => {
  let userId: string;
  let weeklyProgramId: string;

  beforeEach(async () => {
    mockCreateClient.mockReset();
    userId = randomUUID();
    await insertAuthUser(userId, `${userId}@testfake.local`);
    weeklyProgramId = await ensureWeeklyProgram();
  });

  afterEach(async () => {
    await db.delete(profilePrograms).where(eq(profilePrograms.profileId, userId));
    await deleteAuthUser(userId);
  });

  it("auto-subscribes the new member to weekly-web-updates", async () => {
    mockSupabase({ id: userId, email: "newbie@testfake.local" });

    const res = await GET(makeRequest("/auth/callback?token_hash=hash&type=email"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://testfake.local/");

    const rows = await db.select().from(profilePrograms).where(eq(profilePrograms.profileId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].programId).toBe(weeklyProgramId);
  });

  it("does not re-subscribe an existing member who has opted out", async () => {
    // Simulate a member who signed in once (so their profile exists)
    // and then opted out of the weekly update.
    await db.insert(profiles).values({ id: userId, displayName: "Returning" });

    mockSupabase({ id: userId, email: "returning@testfake.local" });

    const res = await GET(makeRequest("/auth/callback?token_hash=hash&type=email"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://testfake.local/");

    const rows = await db.select().from(profilePrograms).where(eq(profilePrograms.profileId, userId));
    expect(rows).toHaveLength(0);
  });
});

describe("GET /auth/callback (invited sign-in, invite query param)", () => {
  let inviterId: string;
  let newUserId: string;
  let weeklyProgramId: string;

  beforeEach(async () => {
    mockCreateClient.mockReset();
    inviterId = randomUUID();
    newUserId = randomUUID();
    await insertAuthUser(inviterId, `${inviterId}@testfake.local`);
    await db.insert(profiles).values({ id: inviterId, displayName: "Inviter" });
    await insertAuthUser(newUserId, `${newUserId}@testfake.local`);
    weeklyProgramId = await ensureWeeklyProgram();
  });

  afterEach(async () => {
    await db.delete(profilePrograms).where(eq(profilePrograms.profileId, newUserId));
    await db.delete(invites).where(eq(invites.createdBy, inviterId));
    await deleteAuthUser(newUserId);
    await deleteAuthUser(inviterId);
  });

  const callbackUrl = (inviteCode: string) => `/auth/callback?token_hash=hash&type=email&invite=${inviteCode}`;

  it("redeems a valid invite and stamps referredBy + displayName", async () => {
    const r = await createInvite({
      createdBy: inviterId,
      note: "welcome to the society, friend",
    });
    if ("error" in r) throw new Error("seed failed");
    mockSupabase({ id: newUserId, email: "newbie@testfake.local" });

    const res = await GET(makeRequest(callbackUrl(r.code)));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://testfake.local/");

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, newUserId));
    expect(profile.referredBy).toBe(inviterId);
    expect(profile.displayName).toBe("New Member");

    const [inviteRow] = await db.select().from(invites).where(eq(invites.code, r.code));
    expect(inviteRow.redeemedBy).toBe(newUserId);
    expect(inviteRow.redeemedAt).not.toBeNull();
  });

  it("signs out and redirects with invite_invalid when the code is already redeemed", async () => {
    const r = await createInvite({
      createdBy: inviterId,
      note: "already-redeemed invite for the callback test",
    });
    if ("error" in r) throw new Error("seed failed");
    // Pre-redeem it.
    await db.update(invites).set({ redeemedBy: inviterId, redeemedAt: sql`now()` }).where(eq(invites.code, r.code));

    const { signOut } = mockSupabase({
      id: newUserId,
      email: "newbie@testfake.local",
    });

    const res = await GET(makeRequest(callbackUrl(r.code)));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://testfake.local/signin?error=invite_invalid");
    expect(signOut).toHaveBeenCalledOnce();

    // No profile created for the would-be new user.
    const rows = await db.select().from(profiles).where(eq(profiles.id, newUserId));
    expect(rows).toHaveLength(0);
  });

  it("redirects with invite_invalid when the code does not exist", async () => {
    const { signOut } = mockSupabase({
      id: newUserId,
      email: "newbie@testfake.local",
    });

    const res = await GET(makeRequest(callbackUrl("ZZZZZZZZZZ")));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://testfake.local/signin?error=invite_invalid");
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("auto-subscribes the newly redeemed member to weekly-web-updates", async () => {
    const r = await createInvite({
      createdBy: inviterId,
      note: "invited path auto-subscribe test",
    });
    if ("error" in r) throw new Error("seed failed");
    mockSupabase({ id: newUserId, email: "newbie@testfake.local" });

    const res = await GET(makeRequest(callbackUrl(r.code)));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://testfake.local/");

    const rows = await db.select().from(profilePrograms).where(eq(profilePrograms.profileId, newUserId));
    expect(rows).toHaveLength(1);
    expect(rows[0].programId).toBe(weeklyProgramId);
  });
});
