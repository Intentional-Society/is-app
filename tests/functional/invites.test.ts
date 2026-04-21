import { randomUUID } from "node:crypto";

import type { User } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";

import app from "@/server/api";
import { db } from "@/server/db";
import {
  checkInvite,
  countActiveInvitesForCreator,
  createInvite,
  getInvitesForCreator,
  redeemInvite,
  revokeInvite,
} from "@/server/invites";
import { invites, profiles } from "@/server/schema";

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

const authAs = (userId: string) => {
  mockCreateServerClient.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: fakeUser(userId) },
        error: null,
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
};

const insertUserAndProfile = async (id: string, isAdmin = false) => {
  await db.execute(
    sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${`${id}@testfake.local`}, false, false)`,
  );
  await db.insert(profiles).values({ id, isAdmin });
};

const deleteUserAndProfile = async (id: string) => {
  await db.delete(invites).where(eq(invites.createdBy, id));
  await db.delete(profiles).where(eq(profiles.id, id));
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
};

describe("invites module", () => {
  let creatorId: string;

  beforeEach(async () => {
    creatorId = randomUUID();
    await insertUserAndProfile(creatorId);
  });

  afterEach(async () => {
    await deleteUserAndProfile(creatorId);
  });

  it("createInvite returns a 10-char alphanumeric code from the restricted alphabet", async () => {
    const result = await createInvite({
      createdBy: creatorId,
      note: "Bringing in a friend from the writing group",
    });
    if ("error" in result) throw new Error("unexpected error");
    expect(result.code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("enforces the 10-active-invite cap", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await createInvite({
        createdBy: creatorId,
        note: `friend number ${i} coming in`,
      });
      expect("code" in r).toBe(true);
    }
    const eleventh = await createInvite({
      createdBy: creatorId,
      note: "one too many friends",
    });
    expect(eleventh).toEqual({ error: "too_many_active", limit: 10 });

    expect(await countActiveInvitesForCreator(creatorId)).toBe(10);
  });

  it("redeeming an invite frees the slot so the creator can mint another", async () => {
    for (let i = 0; i < 10; i++) {
      await createInvite({
        createdBy: creatorId,
        note: `friend number ${i} coming in`,
      });
    }
    // Mark one as redeemed — simulate a successful signup.
    const [oneActive] = await db
      .select({ code: invites.code })
      .from(invites)
      .where(eq(invites.createdBy, creatorId))
      .limit(1);
    await db
      .update(invites)
      .set({ redeemedBy: creatorId, redeemedAt: sql`now()` })
      .where(eq(invites.code, oneActive.code));

    const another = await createInvite({
      createdBy: creatorId,
      note: "new slot opened up here",
    });
    expect("code" in another).toBe(true);
  });

  it("checkInvite reports each status correctly", async () => {
    // Active.
    const active = await createInvite({
      createdBy: creatorId,
      note: "active invite for checkInvite test",
    });
    if ("error" in active) throw new Error("seed failed");
    expect(await checkInvite(active.code)).toEqual({
      valid: true,
      note: "active invite for checkInvite test",
    });

    // Nonexistent.
    expect(await checkInvite("ZZZZZZZZZZ")).toEqual({
      valid: false,
      reason: "not_found",
    });

    // Revoked.
    const revoked = await createInvite({
      createdBy: creatorId,
      note: "revoked invite for checkInvite test",
    });
    if ("error" in revoked) throw new Error("seed failed");
    await db
      .update(invites)
      .set({ revokedAt: sql`now()` })
      .where(eq(invites.code, revoked.code));
    expect(await checkInvite(revoked.code)).toEqual({
      valid: false,
      reason: "revoked",
    });

    // Redeemed.
    const redeemed = await createInvite({
      createdBy: creatorId,
      note: "redeemed invite for checkInvite test",
    });
    if ("error" in redeemed) throw new Error("seed failed");
    await db
      .update(invites)
      .set({ redeemedBy: creatorId, redeemedAt: sql`now()` })
      .where(eq(invites.code, redeemed.code));
    expect(await checkInvite(redeemed.code)).toEqual({
      valid: false,
      reason: "redeemed",
    });

    // Expired. Shift createdAt back too so the check constraint
    // `expiresAt > createdAt` continues to hold after we backdate
    // expiresAt.
    const expired = await createInvite({
      createdBy: creatorId,
      note: "expired invite for checkInvite test",
    });
    if ("error" in expired) throw new Error("seed failed");
    await db
      .update(invites)
      .set({
        createdAt: sql`now() - interval '2 hours'`,
        expiresAt: sql`now() - interval '1 minute'`,
      })
      .where(eq(invites.code, expired.code));
    expect(await checkInvite(expired.code)).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("revokeInvite allows the creator", async () => {
    const r = await createInvite({
      createdBy: creatorId,
      note: "about to revoke this one",
    });
    if ("error" in r) throw new Error("seed failed");

    const result = await revokeInvite({
      code: r.code,
      userId: creatorId,
      isAdmin: false,
    });
    expect(result).toEqual({ ok: true });

    const [row] = await db
      .select({ revokedAt: invites.revokedAt })
      .from(invites)
      .where(eq(invites.code, r.code));
    expect(row.revokedAt).not.toBeNull();
  });

  it("revokeInvite rejects a non-creator non-admin", async () => {
    const r = await createInvite({
      createdBy: creatorId,
      note: "another user should not revoke",
    });
    if ("error" in r) throw new Error("seed failed");

    const strangerId = randomUUID();
    const result = await revokeInvite({
      code: r.code,
      userId: strangerId,
      isAdmin: false,
    });
    expect(result).toEqual({ error: "forbidden" });
  });

  it("revokeInvite allows an admin who is not the creator", async () => {
    const r = await createInvite({
      createdBy: creatorId,
      note: "admin intervention scenario",
    });
    if ("error" in r) throw new Error("seed failed");

    const adminId = randomUUID();
    const result = await revokeInvite({
      code: r.code,
      userId: adminId,
      isAdmin: true,
    });
    expect(result).toEqual({ ok: true });
  });

  it("revokeInvite refuses to revoke an already-redeemed invite", async () => {
    const r = await createInvite({
      createdBy: creatorId,
      note: "already redeemed cannot be revoked",
    });
    if ("error" in r) throw new Error("seed failed");
    await db
      .update(invites)
      .set({ redeemedBy: creatorId, redeemedAt: sql`now()` })
      .where(eq(invites.code, r.code));

    const result = await revokeInvite({
      code: r.code,
      userId: creatorId,
      isAdmin: false,
    });
    expect(result).toEqual({ error: "already_redeemed" });
  });

  it("getInvitesForCreator returns derived status for each row", async () => {
    const a = await createInvite({
      createdBy: creatorId,
      note: "first one in history list",
    });
    const b = await createInvite({
      createdBy: creatorId,
      note: "second one in history list",
    });
    if ("error" in a || "error" in b) throw new Error("seed failed");

    await db
      .update(invites)
      .set({ revokedAt: sql`now()` })
      .where(eq(invites.code, a.code));

    const list = await getInvitesForCreator(creatorId);
    expect(list).toHaveLength(2);
    const byCode = Object.fromEntries(list.map((r) => [r.code, r.status]));
    expect(byCode[a.code]).toBe("revoked");
    expect(byCode[b.code]).toBe("active");
  });
});

describe("POST /api/invites", () => {
  let userId: string;

  beforeEach(async () => {
    userId = randomUUID();
    await insertUserAndProfile(userId);
    authAs(userId);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(userId);
  });

  const post = (body: unknown) =>
    app.request("/api/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("creates an invite and returns 201 with the code", async () => {
    const res = await post({ note: "bringing someone in from the retreat" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(body.note).toBe("bringing someone in from the retreat");
    expect(typeof body.expiresAt).toBe("string");
  });

  it("rejects a note shorter than 10 chars", async () => {
    const res = await post({ note: "too short" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least 10/);
  });

  it("rejects a malformed JSON body", async () => {
    const res = await app.request("/api/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 429 when the user is already at the active cap", async () => {
    for (let i = 0; i < 10; i++) {
      await createInvite({
        createdBy: userId,
        note: `existing invite number ${i}`,
      });
    }
    const res = await post({ note: "eleventh invite should be rejected" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("too_many_active_invites");
    expect(body.limit).toBe(10);
  });
});

describe("GET /api/invites/mine", () => {
  let userId: string;

  beforeEach(async () => {
    userId = randomUUID();
    await insertUserAndProfile(userId);
    authAs(userId);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(userId);
  });

  it("returns only the current user's invites", async () => {
    const otherId = randomUUID();
    await insertUserAndProfile(otherId);
    try {
      await createInvite({
        createdBy: userId,
        note: "mine in the listing test",
      });
      await createInvite({
        createdBy: otherId,
        note: "not mine in the listing test",
      });

      const res = await app.request("/api/invites/mine");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.invites).toHaveLength(1);
      expect(body.invites[0].note).toBe("mine in the listing test");
      expect(body.invites[0].status).toBe("active");
    } finally {
      await deleteUserAndProfile(otherId);
    }
  });
});

describe("POST /api/invites/:code/revoke", () => {
  let creatorId: string;

  beforeEach(async () => {
    creatorId = randomUUID();
    await insertUserAndProfile(creatorId);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(creatorId);
  });

  it("lets the creator revoke their own invite", async () => {
    const r = await createInvite({
      createdBy: creatorId,
      note: "revoked via the route",
    });
    if ("error" in r) throw new Error("seed failed");
    authAs(creatorId);

    const res = await app.request(`/api/invites/${r.code}/revoke`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 when another user tries to revoke", async () => {
    const r = await createInvite({
      createdBy: creatorId,
      note: "403 when stranger attempts",
    });
    if ("error" in r) throw new Error("seed failed");

    const strangerId = randomUUID();
    await insertUserAndProfile(strangerId);
    try {
      authAs(strangerId);
      const res = await app.request(`/api/invites/${r.code}/revoke`, {
        method: "POST",
      });
      expect(res.status).toBe(403);
    } finally {
      await deleteUserAndProfile(strangerId);
    }
  });

  it("lets an admin revoke someone else's invite", async () => {
    const r = await createInvite({
      createdBy: creatorId,
      note: "admin revokes someone else",
    });
    if ("error" in r) throw new Error("seed failed");

    const adminId = randomUUID();
    await insertUserAndProfile(adminId, true);
    try {
      authAs(adminId);
      const res = await app.request(`/api/invites/${r.code}/revoke`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
    } finally {
      await deleteUserAndProfile(adminId);
    }
  });

  it("returns 404 for a nonexistent code", async () => {
    authAs(creatorId);
    const res = await app.request("/api/invites/ZZZZZZZZZZ/revoke", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/invites/:code/check (public)", () => {
  let creatorId: string;
  let activeCode: string;

  beforeAll(async () => {
    creatorId = randomUUID();
    await insertUserAndProfile(creatorId);
    const r = await createInvite({
      createdBy: creatorId,
      note: "public checkable invite",
    });
    if ("error" in r) throw new Error("seed failed");
    activeCode = r.code;
  });

  afterAll(async () => {
    await deleteUserAndProfile(creatorId);
  });

  beforeEach(() => {
    // No session at all — proves the route bypasses auth.
    mockCreateServerClient.mockReset();
  });

  it("returns the note for an active invite without a session", async () => {
    const res = await app.request(`/api/invites/${activeCode}/check`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      valid: true,
      note: "public checkable invite",
    });
    // Never built the Supabase client, proving we bypassed auth.
    expect(mockCreateServerClient).not.toHaveBeenCalled();
  });

  it("returns valid:false with a reason for an unknown code", async () => {
    const res = await app.request("/api/invites/YYYYYYYYYY/check");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      valid: false,
      reason: "not_found",
    });
  });
});

describe("redeemInvite atomic contention", () => {
  let creatorId: string;
  let redeemerA: string;
  let redeemerB: string;

  beforeEach(async () => {
    creatorId = randomUUID();
    redeemerA = randomUUID();
    redeemerB = randomUUID();
    await insertUserAndProfile(creatorId);
    await insertUserAndProfile(redeemerA);
    await insertUserAndProfile(redeemerB);
  });

  afterEach(async () => {
    await deleteUserAndProfile(creatorId);
    await deleteUserAndProfile(redeemerA);
    await deleteUserAndProfile(redeemerB);
  });

  it("two concurrent redemptions of the same code — exactly one wins", async () => {
    const r = await createInvite({
      createdBy: creatorId,
      note: "contention test invite for concurrency",
    });
    if ("error" in r) throw new Error("seed failed");

    const [resA, resB] = await Promise.all([
      redeemInvite({ code: r.code, userId: redeemerA }),
      redeemInvite({ code: r.code, userId: redeemerB }),
    ]);

    const successes = [resA, resB].filter((x) => "ok" in x);
    const failures = [resA, resB].filter((x) => "error" in x);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // DB reflects the winner.
    const [row] = await db
      .select({
        redeemedBy: invites.redeemedBy,
        redeemedAt: invites.redeemedAt,
      })
      .from(invites)
      .where(eq(invites.code, r.code));
    expect(row.redeemedBy).not.toBeNull();
    expect(row.redeemedAt).not.toBeNull();
    expect([redeemerA, redeemerB]).toContain(row.redeemedBy);
  });
});
