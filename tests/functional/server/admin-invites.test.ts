import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";

import app from "@/server/api";
import { db } from "@/server/db";
import { inviteHints, invites, profiles } from "@/server/schema";

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

const insertUserAndProfile = async (id: string, opts: { isAdmin?: boolean; displayName?: string } = {}) => {
  await db.execute(
    sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${`${id}@testfake.local`}, false, false)`,
  );
  await db.insert(profiles).values({ id, isAdmin: opts.isAdmin ?? false, displayName: opts.displayName ?? null });
};

const deleteUserAndProfile = async (id: string) => {
  await db.delete(profiles).where(eq(profiles.id, id));
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
};

type AdminInvite = {
  id: string;
  code: string;
  note: string;
  status: string;
  creatorName: string | null;
  redeemerName: string | null;
};

describe("Admin invites API", () => {
  let admin: string;
  let nonAdmin: string;
  let creator: string;
  let redeemer: string;
  // Invites seeded during a test — torn down in afterEach. Deleting an
  // invite cascades its invite_hints rows, so this also clears hints.
  let createdInviteIds: string[];

  const seedInvite = async (
    opts: { note?: string; createdBy?: string; redeemedBy?: string; redeemedAt?: Date; revokedAt?: Date } = {},
  ): Promise<string> => {
    const id = randomUUID();
    await db.insert(invites).values({
      id,
      code: `inv-${id.slice(0, 12)}`,
      createdBy: opts.createdBy ?? creator,
      note: opts.note ?? "Bringing a friend in",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      redeemedBy: opts.redeemedBy ?? null,
      redeemedAt: opts.redeemedAt ?? null,
      revokedAt: opts.revokedAt ?? null,
    });
    createdInviteIds.push(id);
    return id;
  };

  beforeEach(async () => {
    admin = randomUUID();
    nonAdmin = randomUUID();
    creator = randomUUID();
    redeemer = randomUUID();
    createdInviteIds = [];
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(nonAdmin);
    await insertUserAndProfile(creator, { displayName: "Casey Creator" });
    await insertUserAndProfile(redeemer, { displayName: "Riley Redeemer" });
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    if (createdInviteIds.length > 0) {
      await db.delete(invites).where(inArray(invites.id, createdInviteIds));
    }
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(nonAdmin);
    await deleteUserAndProfile(creator);
    await deleteUserAndProfile(redeemer);
  });

  describe("GET /api/admin/invites", () => {
    it("lists invites with note, status, code and resolved creator/redeemer names", async () => {
      const activeId = await seedInvite({ note: "Active one" });
      const redeemedId = await seedInvite({ note: "Redeemed one", redeemedBy: redeemer, redeemedAt: new Date() });

      authAs(admin);
      const res = await app.request("/api/admin/invites");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { invites: AdminInvite[] };

      const active = body.invites.find((i) => i.id === activeId);
      expect(active).toMatchObject({ note: "Active one", status: "active", creatorName: "Casey Creator" });
      expect(active?.redeemerName).toBeNull();
      expect(active?.code).toBeTruthy();

      const redeemed = body.invites.find((i) => i.id === redeemedId);
      expect(redeemed).toMatchObject({
        status: "redeemed",
        creatorName: "Casey Creator",
        redeemerName: "Riley Redeemer",
      });
    });

    it("returns 404 for a non-admin", async () => {
      authAs(nonAdmin);
      const res = await app.request("/api/admin/invites");
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/admin/invites/:id", () => {
    const del = (id: string) => app.request(`/api/admin/invites/${id}`, { method: "DELETE" });

    it("hard-deletes an invite and cascades its hints", async () => {
      const id = await seedInvite();
      await db.insert(inviteHints).values({ inviteId: id, relateeId: redeemer });

      authAs(admin);
      const res = await del(id);
      expect(res.status).toBe(200);

      const rows = await db.select().from(invites).where(eq(invites.id, id));
      expect(rows).toHaveLength(0);
      const hints = await db.select().from(inviteHints).where(eq(inviteHints.inviteId, id));
      expect(hints).toHaveLength(0);
    });

    it("returns 404 for a non-existent invite", async () => {
      authAs(admin);
      const res = await del(randomUUID());
      expect(res.status).toBe(404);
    });

    it("returns 400 for a non-UUID id", async () => {
      authAs(admin);
      const res = await del("not-a-uuid");
      expect(res.status).toBe(400);
    });

    it("returns 404 for a non-admin and leaves the invite intact", async () => {
      const id = await seedInvite();

      authAs(nonAdmin);
      const res = await del(id);
      expect(res.status).toBe(404);

      const rows = await db.select().from(invites).where(eq(invites.id, id));
      expect(rows).toHaveLength(1);
    });
  });
});
