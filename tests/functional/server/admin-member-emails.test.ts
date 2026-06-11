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
import { E2E_EMAILS } from "@/server/test-reset";

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

const insertUserAndProfile = async (id: string, opts: { isAdmin?: boolean; email?: string } = {}) => {
  await db.execute(
    sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${opts.email ?? `${id}@testfake.local`}, false, false)`,
  );
  await db.insert(profiles).values({ id, isAdmin: opts.isAdmin ?? false });
};

const deleteUserAndProfile = async (id: string) => {
  await db.delete(profiles).where(eq(profiles.id, id));
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
};

describe("GET /api/admin/member-emails", () => {
  let admin: string;
  let active: string;
  let hiddenMember: string;
  let deactivated: string;
  // The seeded e2e account may already exist (dev DBs run the e2e
  // seed script; fresh CI DBs don't), so create it only when absent
  // and clean up only what this run created.
  const E2E_EMAIL = E2E_EMAILS[0];
  let e2eId: string;
  let e2eUserCreated = false;
  let e2eProfileCreated = false;

  beforeEach(async () => {
    admin = randomUUID();
    active = randomUUID();
    hiddenMember = randomUUID();
    deactivated = randomUUID();
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(active);
    await insertUserAndProfile(hiddenMember);
    await insertUserAndProfile(deactivated);
    await db.update(profiles).set({ hidden: true }).where(eq(profiles.id, hiddenMember));
    await db.update(profiles).set({ deactivatedAt: new Date() }).where(eq(profiles.id, deactivated));

    const existing = (await db.execute(sql`SELECT id FROM auth.users WHERE email = ${E2E_EMAIL}`)) as unknown as {
      id: string;
    }[];
    if (existing.length > 0) {
      e2eId = existing[0].id;
    } else {
      e2eId = randomUUID();
      await db.execute(
        sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${e2eId}::uuid, ${E2E_EMAIL}, false, false)`,
      );
      e2eUserCreated = true;
    }
    const existingProfile = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, e2eId));
    if (existingProfile.length === 0) {
      await db.insert(profiles).values({ id: e2eId });
      e2eProfileCreated = true;
    }
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(active);
    await deleteUserAndProfile(hiddenMember);
    await deleteUserAndProfile(deactivated);
    if (e2eProfileCreated) await db.delete(profiles).where(eq(profiles.id, e2eId));
    if (e2eUserCreated) await db.execute(sql`DELETE FROM auth.users WHERE id = ${e2eId}::uuid`);
    e2eUserCreated = false;
    e2eProfileCreated = false;
  });

  it("returns active member emails sorted, excluding hidden, deactivated, and e2e accounts", async () => {
    authAs(admin);
    const res = await app.request("/api/admin/member-emails");
    expect(res.status).toBe(200);
    const { emails } = (await res.json()) as { emails: string[] };

    // Other test files seed users concurrently, so assert on this
    // test's fixtures only — filtering preserves relative order.
    const fixtureEmails = [admin, active, hiddenMember, deactivated].map((id) => `${id}@testfake.local`);
    const mine = emails.filter((e) => fixtureEmails.includes(e));
    expect(mine).toEqual([`${admin}@testfake.local`, `${active}@testfake.local`].sort());

    expect(emails).not.toContain(`${hiddenMember}@testfake.local`);
    expect(emails).not.toContain(`${deactivated}@testfake.local`);
    for (const e2eEmail of E2E_EMAILS) {
      expect(emails).not.toContain(e2eEmail);
    }
  });

  it("returns 404 for an authenticated non-admin", async () => {
    authAs(active);
    const res = await app.request("/api/admin/member-emails");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 401 when no session is present", async () => {
    authAs(null);
    const res = await app.request("/api/admin/member-emails");
    expect(res.status).toBe(401);
  });
});
