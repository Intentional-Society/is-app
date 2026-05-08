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

const mockCreateServerClient = vi.mocked(createServerClient);

const makeUser = (id: string, email: string): User =>
  ({
    id,
    email,
    user_metadata: {},
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  }) as User;

describe("Programs API", () => {
  let userId: string;
  let programId: string;

  beforeEach(async () => {
    userId = randomUUID();
    programId = randomUUID();

    await db.execute(
      sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous)
          VALUES (${userId}::uuid, ${`programs-${userId.slice(0, 8)}@testfake.local`}, false, false)`,
    );
    await db.insert(profiles).values({ id: userId });
    await db.insert(programs).values({
      id: programId,
      slug: `test-program-${programId.slice(0, 8)}`,
      name: "Test Program",
      description: "A program for testing.",
    });

    mockCreateServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: makeUser(userId, `programs-${userId.slice(0, 8)}@testfake.local`) },
          error: null,
        }),
      },
      // biome-ignore lint/suspicious/noExplicitAny: test mock shape
    } as any);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await db.delete(profilePrograms).where(eq(profilePrograms.profileId, userId));
    await db.delete(profiles).where(eq(profiles.id, userId));
    await db.delete(programs).where(eq(programs.id, programId));
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`);
  });

  describe("GET /api/programs", () => {
    it("returns programs with membership status and member count", async () => {
      const res = await app.request("/api/programs");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.programs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: programId,
            name: "Test Program",
            description: "A program for testing.",
            memberCount: 0,
            joined: false,
            joinedAt: null,
          }),
        ]),
      );
    });

    it("reflects joined status after joining", async () => {
      await db.insert(profilePrograms).values({ profileId: userId, programId });

      const res = await app.request("/api/programs");
      expect(res.status).toBe(200);

      const body = await res.json();
      const program = body.programs.find((p: { id: string }) => p.id === programId);
      expect(program.joined).toBe(true);
      expect(program.joinedAt).toBeTruthy();
      expect(program.memberCount).toBe(1);
    });
  });

  describe("POST /api/programs/:id/join", () => {
    it("joins a program successfully", async () => {
      const res = await app.request(`/api/programs/${programId}/join`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // Verify DB row
      const [row] = await db.select().from(profilePrograms).where(eq(profilePrograms.profileId, userId));
      expect(row).toBeTruthy();
      expect(row.programId).toBe(programId);
    });

    it("returns 409 when already joined", async () => {
      await db.insert(profilePrograms).values({ profileId: userId, programId });

      const res = await app.request(`/api/programs/${programId}/join`, {
        method: "POST",
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "already_joined" });
    });

    it("returns 404 for non-existent program", async () => {
      const fakeId = randomUUID();
      const res = await app.request(`/api/programs/${fakeId}/join`, {
        method: "POST",
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });

    it("returns 404 for invalid UUID", async () => {
      const res = await app.request("/api/programs/not-a-uuid/join", {
        method: "POST",
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });
  });

  describe("POST /api/programs/:id/leave", () => {
    it("leaves a program successfully", async () => {
      await db.insert(profilePrograms).values({ profileId: userId, programId });

      const res = await app.request(`/api/programs/${programId}/leave`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // Verify row deleted
      const rows = await db.select().from(profilePrograms).where(eq(profilePrograms.profileId, userId));
      expect(rows).toHaveLength(0);
    });

    it("returns 404 when not a member", async () => {
      const res = await app.request(`/api/programs/${programId}/leave`, {
        method: "POST",
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });
  });
});
