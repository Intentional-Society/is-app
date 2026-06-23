import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

// deleteMemberAccount calls supabaseAdmin.auth.admin.deleteUser; clearAvatar
// (also reached) touches supabaseAdmin.storage. Mock the whole admin client.
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: { admin: { deleteUser: vi.fn() } },
    storage: {
      from: () => ({
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
        createSignedUrls: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    },
  },
}));

import { createServerClient } from "@supabase/ssr";

import { supabaseAdmin } from "@/lib/supabase/admin";
import app from "@/server/api";
import { db } from "@/server/db";
import { invites, profilePrograms, profiles, programs, relations } from "@/server/schema";

const mockCreateServerClient = vi.mocked(createServerClient);
const mockDeleteUser = vi.mocked(supabaseAdmin.auth.admin.deleteUser);

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
      getUser: vi.fn().mockResolvedValue({ data: { user: userId ? fakeUser(userId) : null }, error: null }),
    },
    // biome-ignore lint/suspicious/noExplicitAny: test mock shape
  } as any);
};

const insertMember = async (id: string, opts: { isAdmin?: boolean; displayName?: string } = {}) => {
  await db.execute(
    sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${`${id}@testfake.local`}, false, false)`,
  );
  await db.insert(profiles).values({ id, isAdmin: opts.isAdmin ?? false, displayName: opts.displayName ?? null });
};

const removeMember = async (id: string) => {
  await db.delete(profiles).where(eq(profiles.id, id));
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
};

const profileExists = async (id: string): Promise<boolean> => {
  const [row] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, id));
  return Boolean(row);
};

describe("DELETE /api/admin/members/:id", () => {
  let admin: string;
  let target: string;

  beforeEach(async () => {
    admin = randomUUID();
    target = randomUUID();
    mockDeleteUser.mockResolvedValue({ data: { user: null }, error: null } as never);
    await insertMember(admin, { isAdmin: true, displayName: "Admin" });
    authAs(admin);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    mockDeleteUser.mockReset();
    // Defensive cleanup — a test may have already deleted `target`.
    await removeMember(target);
    await removeMember(admin);
  });

  it("deletes a member: profile + memberships gone, deleteUser called", async () => {
    await insertMember(target, { displayName: "Target Member" });
    const programId = randomUUID();
    await db.insert(programs).values({ id: programId, slug: `p-${programId.slice(0, 8)}`, name: "P" });
    await db.insert(profilePrograms).values({ profileId: target, programId });

    const res = await app.request(`/api/admin/members/${target}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(await profileExists(target)).toBe(false);
    const memberships = await db.select().from(profilePrograms).where(eq(profilePrograms.profileId, target));
    expect(memberships).toHaveLength(0);
    expect(mockDeleteUser).toHaveBeenCalledWith(target);

    await db.delete(programs).where(eq(programs.id, programId));
  });

  it("cascades relations and anonymizes invites the member created", async () => {
    const other = randomUUID();
    await insertMember(target, { displayName: "Target" });
    await insertMember(other, { displayName: "Other" });
    // A rated relation requires a value 1-4 (relations_hint_state check).
    await db.insert(relations).values({ relatorId: target, relateeId: other, value: 2 });
    const inviteId = randomUUID();
    await db.insert(invites).values({
      id: inviteId,
      code: `code-${inviteId.slice(0, 8)}`,
      createdBy: target,
      note: "come on in",
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const res = await app.request(`/api/admin/members/${target}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const rels = await db.select().from(relations).where(eq(relations.relatorId, target));
    expect(rels).toHaveLength(0); // cascade
    const [invite] = await db.select().from(invites).where(eq(invites.id, inviteId));
    expect(invite).toBeDefined(); // survives
    expect(invite.createdBy).toBeNull(); // anonymized

    await db.delete(invites).where(eq(invites.id, inviteId));
    await removeMember(other);
  });

  it("refuses self-delete with 403", async () => {
    const res = await app.request(`/api/admin/members/${admin}`, { method: "DELETE" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "self_delete" });
    expect(await profileExists(admin)).toBe(true);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("refuses deleting another admin with 409", async () => {
    await insertMember(target, { isAdmin: true, displayName: "Other Admin" });
    const res = await app.request(`/api/admin/members/${target}`, { method: "DELETE" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "is_admin" });
    expect(await profileExists(target)).toBe(true);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown member", async () => {
    const res = await app.request(`/api/admin/members/${randomUUID()}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 400 for a non-UUID id", async () => {
    const res = await app.request("/api/admin/members/not-a-uuid", { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  it("returns 404 (route hidden) when the caller is not an admin", async () => {
    await insertMember(target, { displayName: "Caller" });
    authAs(target); // a non-admin signs in and tries to delete the admin
    const res = await app.request(`/api/admin/members/${admin}`, { method: "DELETE" });
    // requireAdmin hides admin routes from non-admins behind a 404.
    expect(res.status).toBe(404);
    expect(await profileExists(admin)).toBe(true);
  });
});
