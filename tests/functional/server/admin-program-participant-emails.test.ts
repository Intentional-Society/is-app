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
import { profilePrograms, profiles, programs } from "@/server/schema";
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

const createProgram = async (): Promise<string> => {
  const slug = `test-prog-${randomUUID()}`;
  const [row] = await db.insert(programs).values({ slug, name: slug }).returning({ id: programs.id });
  return row.id;
};

const join = async (profileId: string, programId: string, opts: { leftAt?: Date } = {}) => {
  await db.insert(profilePrograms).values({ profileId, programId, leftAt: opts.leftAt });
};

describe("GET /api/admin/programs/:id/participant-emails", () => {
  let admin: string;
  let active: string;
  let hiddenMember: string;
  let deactivated: string;
  let leftMember: string;
  let otherProgramMember: string;
  let programId: string;
  let otherProgramId: string;
  // The seeded e2e account may already exist (dev DBs run the e2e seed
  // script; fresh CI DBs don't), so create it only when absent and clean
  // up only what this run created.
  const E2E_EMAIL = E2E_EMAILS[0];
  let e2eId: string;
  let e2eUserCreated = false;
  let e2eProfileCreated = false;

  beforeEach(async () => {
    admin = randomUUID();
    active = randomUUID();
    hiddenMember = randomUUID();
    deactivated = randomUUID();
    leftMember = randomUUID();
    otherProgramMember = randomUUID();
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(active);
    await insertUserAndProfile(hiddenMember);
    await insertUserAndProfile(deactivated);
    await insertUserAndProfile(leftMember);
    await insertUserAndProfile(otherProgramMember);
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

    programId = await createProgram();
    otherProgramId = await createProgram();
    // Active, non-excluded participant — the only one that should appear.
    await join(active, programId);
    // Excluded by profile state.
    await join(hiddenMember, programId);
    await join(deactivated, programId);
    await join(e2eId, programId);
    // Past member of this program (left_at set) — excluded.
    await join(leftMember, programId, { leftAt: new Date() });
    // Active member of a different program — excluded from this one.
    await join(otherProgramMember, otherProgramId);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    // Deleting programs cascades their profile_programs rows (incl. the
    // shared e2e account's membership), so memberships need no explicit
    // cleanup.
    await db.delete(programs).where(eq(programs.id, programId));
    await db.delete(programs).where(eq(programs.id, otherProgramId));
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(active);
    await deleteUserAndProfile(hiddenMember);
    await deleteUserAndProfile(deactivated);
    await deleteUserAndProfile(leftMember);
    await deleteUserAndProfile(otherProgramMember);
    if (e2eProfileCreated) await db.delete(profiles).where(eq(profiles.id, e2eId));
    if (e2eUserCreated) await db.execute(sql`DELETE FROM auth.users WHERE id = ${e2eId}::uuid`);
    e2eUserCreated = false;
    e2eProfileCreated = false;
  });

  it("returns only this program's active, mailable participants", async () => {
    authAs(admin);
    const res = await app.request(`/api/admin/programs/${programId}/participant-emails`);
    expect(res.status).toBe(200);
    const { emails } = (await res.json()) as { emails: string[] };

    // Program-scoped fixtures are unique to this run, so the list is exact.
    expect(emails).toEqual([`${active}@testfake.local`]);
    expect(emails).not.toContain(`${hiddenMember}@testfake.local`);
    expect(emails).not.toContain(`${deactivated}@testfake.local`);
    expect(emails).not.toContain(`${leftMember}@testfake.local`);
    expect(emails).not.toContain(`${otherProgramMember}@testfake.local`);
    for (const e2eEmail of E2E_EMAILS) {
      expect(emails).not.toContain(e2eEmail);
    }
  });

  it("returns an empty list for an unknown program id", async () => {
    authAs(admin);
    const res = await app.request(`/api/admin/programs/${randomUUID()}/participant-emails`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ emails: [] });
  });

  it("returns 404 for an authenticated non-admin", async () => {
    authAs(active);
    const res = await app.request(`/api/admin/programs/${programId}/participant-emails`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 401 when no session is present", async () => {
    authAs(null);
    const res = await app.request(`/api/admin/programs/${programId}/participant-emails`);
    expect(res.status).toBe(401);
  });
});
