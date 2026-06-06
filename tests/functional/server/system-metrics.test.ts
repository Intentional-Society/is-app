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
import { invites, profilePrograms, profiles, programs, relations } from "@/server/schema";

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

const insertUserAndProfile = async (id: string, opts: { isAdmin?: boolean; hidden?: boolean } = {}) => {
  await db.execute(
    sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${`${id}@testfake.local`}, false, false)`,
  );
  await db.insert(profiles).values({ id, isAdmin: opts.isAdmin ?? false, hidden: opts.hidden ?? false });
};

const deleteUserAndProfile = async (id: string) => {
  await db.delete(profiles).where(eq(profiles.id, id));
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
};

type SystemMetrics = {
  members: {
    total: number;
    new7d: number;
    new30d: number;
    deactivated: number;
    signedAgreements: number;
    setIntention: number;
    updatedProfile: number;
    builtWeb: number;
    joinedProgram: number;
    signedIn7d: number;
    signedIn30d: number;
  };
  invites: {
    created: number;
    redeemed: number;
    pending: number;
    expired: number;
    revoked: number;
    redeemedNames: { id: string; name: string | null }[];
  };
};

const INVITE_COUNT_KEYS = ["created", "redeemed", "pending", "expired", "revoked"] as const;

const fetchMetrics = async (): Promise<SystemMetrics> => {
  const res = await app.request("/api/metrics");
  expect(res.status).toBe(200);
  return ((await res.json()) as { metrics: SystemMetrics }).metrics;
};

describe("GET /api/metrics", () => {
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

  it("is readable by any authenticated member, not just admins", async () => {
    authAs(nonAdmin);
    const res = await app.request("/api/metrics");
    expect(res.status).toBe(200);
  });

  it("returns 401 when no session is present", async () => {
    authAs(null);
    const res = await app.request("/api/metrics");
    expect(res.status).toBe(401);
  });

  it("returns a numeric value for every count bucket", async () => {
    authAs(admin);
    const m = await fetchMetrics();
    for (const v of Object.values(m.members)) expect(typeof v).toBe("number");
    for (const k of INVITE_COUNT_KEYS) expect(typeof m.invites[k]).toBe("number");
    expect(Array.isArray(m.invites.redeemedNames)).toBe(true);
  });

  it("counts a seeded member's progress in the right buckets", async () => {
    // Counts are global and the local DB is shared across parallel test
    // files, so exact totals are unstable. Seed a known cohort and assert
    // each bucket is at least our contribution — that catches a column or
    // table wired to the wrong source (the bug class here) without racing
    // other files' inserts and deletes.
    const member = randomUUID();
    const relatee = randomUUID();
    const programId = randomUUID();
    await insertUserAndProfile(member);
    // hidden so it also exercises the visible-only filter on builtWeb's relatee join
    await insertUserAndProfile(relatee, { hidden: true });
    await db
      .update(profiles)
      .set({
        lastSignedAgreements: new Date(),
        currentIntention: "be present",
        lastUpdatedProfile: new Date(),
        displayName: "Redeemer One",
      })
      .where(eq(profiles.id, member));
    await db.execute(sql`UPDATE auth.users SET last_sign_in_at = now() WHERE id = ${member}::uuid`);
    await db.insert(programs).values({ id: programId, slug: `prog-${programId}`, name: "Test Program" });
    await db.insert(profilePrograms).values({ profileId: member, programId });
    await db.insert(relations).values({ relatorId: member, relateeId: relatee, value: 3, isHint: false });

    const inviteRedeemed = randomUUID();
    const invitePending = randomUUID();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(invites).values([
      {
        id: inviteRedeemed,
        code: `r-${inviteRedeemed}`,
        note: "redeemed invite",
        expiresAt: tomorrow,
        redeemedBy: member,
        redeemedAt: new Date(),
      },
      { id: invitePending, code: `p-${invitePending}`, note: "pending invite", expiresAt: tomorrow },
    ]);

    authAs(admin);
    const m = await fetchMetrics();
    expect(m.members.total).toBeGreaterThanOrEqual(1);
    expect(m.members.new7d).toBeGreaterThanOrEqual(1);
    expect(m.members.signedAgreements).toBeGreaterThanOrEqual(1);
    expect(m.members.setIntention).toBeGreaterThanOrEqual(1);
    expect(m.members.updatedProfile).toBeGreaterThanOrEqual(1);
    expect(m.members.builtWeb).toBeGreaterThanOrEqual(1);
    expect(m.members.joinedProgram).toBeGreaterThanOrEqual(1);
    expect(m.members.signedIn7d).toBeGreaterThanOrEqual(1);
    expect(m.members.signedIn30d).toBeGreaterThanOrEqual(1);
    expect(m.invites.created).toBeGreaterThanOrEqual(2);
    expect(m.invites.redeemed).toBeGreaterThanOrEqual(1);
    expect(m.invites.pending).toBeGreaterThanOrEqual(1);
    // Redeemed lists the joining member's display name (visible members only).
    expect(m.invites.redeemedNames.some((r) => r.name === "Redeemer One")).toBe(true);

    await db.delete(invites).where(sql`${invites.id} IN (${inviteRedeemed}::uuid, ${invitePending}::uuid)`);
    await db.delete(relations).where(eq(relations.relatorId, member));
    await db.delete(profilePrograms).where(eq(profilePrograms.profileId, member));
    await db.delete(programs).where(eq(programs.id, programId));
    await deleteUserAndProfile(member);
    await deleteUserAndProfile(relatee);
  });
});
