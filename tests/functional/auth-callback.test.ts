import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { GET } from "@/app/auth/callback/route";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/server/db";
import { createInvite } from "@/server/invites";
import { invites, profiles } from "@/server/schema";

const mockCreateClient = vi.mocked(createClient);

const makeRequest = (path: string) =>
  new NextRequest(new URL(path, "http://testfake.local"));

const mockSupabase = (user: { id: string; email: string } | null) => {
  const signOut = vi.fn().mockResolvedValue({ error: null });
  mockCreateClient.mockResolvedValue({
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

describe("GET /auth/callback", () => {
  beforeEach(() => {
    mockCreateClient.mockReset();
  });

  it("redirects to /login?error=missing_code when the code query param is absent", async () => {
    const res = await GET(makeRequest("/auth/callback"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://testfake.local/login?error=missing_code",
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("redirects to /login?error=exchange_failed when exchangeCodeForSession errors", async () => {
    mockSupabase(null);

    const res = await GET(makeRequest("/auth/callback?code=bad-code"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://testfake.local/login?error=exchange_failed",
    );
  });
});

describe("GET /auth/callback?invite=... (invited sign-in)", () => {
  let inviterId: string;
  let newUserId: string;

  beforeEach(async () => {
    mockCreateClient.mockReset();
    inviterId = randomUUID();
    newUserId = randomUUID();
    await insertAuthUser(inviterId, `${inviterId}@testfake.local`);
    await db.insert(profiles).values({ id: inviterId, displayName: "Inviter" });
    await insertAuthUser(newUserId, `${newUserId}@testfake.local`);
  });

  afterEach(async () => {
    await db.delete(invites).where(eq(invites.createdBy, inviterId));
    await deleteAuthUser(newUserId);
    await deleteAuthUser(inviterId);
  });

  it("redeems a valid invite and stamps referredBy + displayName", async () => {
    const r = await createInvite({
      createdBy: inviterId,
      note: "welcome to the society, friend",
    });
    if ("error" in r) throw new Error("seed failed");
    mockSupabase({ id: newUserId, email: "newbie@testfake.local" });

    const res = await GET(
      makeRequest(`/auth/callback?code=pkce&invite=${r.code}`),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://testfake.local/");

    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, newUserId));
    expect(profile.referredBy).toBe(inviterId);
    expect(profile.displayName).toBe("New Member");

    const [inviteRow] = await db
      .select()
      .from(invites)
      .where(eq(invites.code, r.code));
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
    await db
      .update(invites)
      .set({ redeemedBy: inviterId, redeemedAt: sql`now()` })
      .where(eq(invites.code, r.code));

    const { signOut } = mockSupabase({
      id: newUserId,
      email: "newbie@testfake.local",
    });

    const res = await GET(
      makeRequest(`/auth/callback?code=pkce&invite=${r.code}`),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://testfake.local/login?error=invite_invalid",
    );
    expect(signOut).toHaveBeenCalledOnce();

    // No profile created for the would-be new user.
    const rows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, newUserId));
    expect(rows).toHaveLength(0);
  });

  it("redirects with invite_invalid when the code does not exist", async () => {
    const { signOut } = mockSupabase({
      id: newUserId,
      email: "newbie@testfake.local",
    });

    const res = await GET(
      makeRequest("/auth/callback?code=pkce&invite=ZZZZZZZZZZ"),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://testfake.local/login?error=invite_invalid",
    );
    expect(signOut).toHaveBeenCalledOnce();
  });
});
