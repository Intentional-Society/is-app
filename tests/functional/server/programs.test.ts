import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

// ESM module namespaces aren't configurable, so vi.spyOn on the
// @sentry/nextjs export fails. Mocking the module up front lets the
// missing-program test assert on calls to captureException.
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { createServerClient } from "@supabase/ssr";

import app from "@/server/api";
import { db } from "@/server/db";
import { autoSubscribeNewMember } from "@/server/programs";
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
      // Tests exercising the member-facing join path need signups open;
      // the closed-by-default policy is exercised by a dedicated test.
      signupsOpen: true,
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
            signupsOpen: true,
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

    it("hides archived programs from the member listing", async () => {
      await db.update(programs).set({ archivedAt: sql`now()` }).where(eq(programs.id, programId));

      const res = await app.request("/api/programs");
      const body = await res.json();
      const hit = body.programs.find((p: { id: string }) => p.id === programId);
      expect(hit).toBeUndefined();
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

    it("returns 409 signups_closed when the program has signups disabled", async () => {
      await db.update(programs).set({ signupsOpen: false }).where(eq(programs.id, programId));

      const res = await app.request(`/api/programs/${programId}/join`, { method: "POST" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "signups_closed" });

      // No membership row landed.
      const rows = await db.select().from(profilePrograms).where(eq(profilePrograms.profileId, userId));
      expect(rows).toHaveLength(0);
    });

    it("returns 404 when the program is archived", async () => {
      await db.update(programs).set({ archivedAt: sql`now()` }).where(eq(programs.id, programId));

      const res = await app.request(`/api/programs/${programId}/join`, { method: "POST" });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });
  });

  describe("POST /api/programs/:id/leave", () => {
    it("leaves a program by stamping left_at (soft delete)", async () => {
      await db.insert(profilePrograms).values({ profileId: userId, programId });

      const res = await app.request(`/api/programs/${programId}/leave`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // Row survives — leftAt stamps the soft delete.
      const [row] = await db
        .select()
        .from(profilePrograms)
        .where(and(eq(profilePrograms.profileId, userId), eq(profilePrograms.programId, programId)));
      expect(row).toBeDefined();
      expect(row.leftAt).not.toBeNull();
    });

    it("returns 404 when not a member", async () => {
      const res = await app.request(`/api/programs/${programId}/leave`, {
        method: "POST",
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });

    it("returns 404 on a double-leave (idempotent past the first)", async () => {
      await db.insert(profilePrograms).values({ profileId: userId, programId });

      let res = await app.request(`/api/programs/${programId}/leave`, { method: "POST" });
      expect(res.status).toBe(200);

      res = await app.request(`/api/programs/${programId}/leave`, { method: "POST" });
      expect(res.status).toBe(404);
    });
  });

  describe("join → leave → rejoin preserves the first-joined date", () => {
    it("keeps the original assigned_at across a leave/rejoin cycle", async () => {
      // First join
      let res = await app.request(`/api/programs/${programId}/join`, { method: "POST" });
      expect(res.status).toBe(200);

      const [firstRow] = await db
        .select()
        .from(profilePrograms)
        .where(and(eq(profilePrograms.profileId, userId), eq(profilePrograms.programId, programId)));
      const originalAssignedAt = firstRow.assignedAt;
      expect(originalAssignedAt).toBeInstanceOf(Date);
      expect(firstRow.leftAt).toBeNull();

      // Leave — soft delete stamps leftAt, row persists with same assignedAt.
      res = await app.request(`/api/programs/${programId}/leave`, { method: "POST" });
      expect(res.status).toBe(200);

      const [afterLeave] = await db
        .select()
        .from(profilePrograms)
        .where(and(eq(profilePrograms.profileId, userId), eq(profilePrograms.programId, programId)));
      expect(afterLeave.leftAt).not.toBeNull();
      expect(afterLeave.assignedAt.getTime()).toBe(originalAssignedAt.getTime());

      // Rejoin — leftAt clears, assignedAt is unchanged.
      res = await app.request(`/api/programs/${programId}/join`, { method: "POST" });
      expect(res.status).toBe(200);

      const [afterRejoin] = await db
        .select()
        .from(profilePrograms)
        .where(and(eq(profilePrograms.profileId, userId), eq(profilePrograms.programId, programId)));
      expect(afterRejoin.leftAt).toBeNull();
      expect(afterRejoin.assignedAt.getTime()).toBe(originalAssignedAt.getTime());

      // GET /programs surfaces the original date as joinedAt.
      const list = await app.request("/api/programs");
      const body = await list.json();
      const program = body.programs.find((p: { id: string }) => p.id === programId);
      expect(program.joined).toBe(true);
      expect(new Date(program.joinedAt).getTime()).toBe(originalAssignedAt.getTime());
    });

    it("treats a second join while currently joined as already_joined", async () => {
      let res = await app.request(`/api/programs/${programId}/join`, { method: "POST" });
      expect(res.status).toBe(200);

      res = await app.request(`/api/programs/${programId}/join`, { method: "POST" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "already_joined" });
    });

    it("member count and joined flag ignore left rows", async () => {
      await db.insert(profilePrograms).values({ profileId: userId, programId, leftAt: new Date() });

      const res = await app.request("/api/programs");
      const body = await res.json();
      const program = body.programs.find((p: { id: string }) => p.id === programId);
      expect(program.memberCount).toBe(0);
      expect(program.joined).toBe(false);
      expect(program.joinedAt).toBeNull();
    });
  });
});

// Look up the auto-subscribe target's id, inserting it if the local
// schema doesn't already have it from the dev seed. Returns the program
// id either way. The cleanup half tells the caller whether the row was
// inserted by this helper (so the test can drop it without trampling
// seed data).
const ensureWeeklyProgram = async (): Promise<{ id: string; insertedByTest: boolean }> => {
  const [existing] = await db
    .select({ id: programs.id })
    .from(programs)
    .where(eq(programs.slug, "weekly-web-updates"));
  if (existing) return { id: existing.id, insertedByTest: false };

  const [row] = await db
    .insert(programs)
    .values({
      slug: "weekly-web-updates",
      name: "Weekly Web Updates",
      description: "Auto-subscribe target (test-inserted).",
    })
    .returning({ id: programs.id });
  return { id: row.id, insertedByTest: true };
};

describe("autoSubscribeNewMember", () => {
  let userId: string;
  let weeklyProgramId: string;
  let weeklyInsertedByTest: boolean;

  beforeEach(async () => {
    userId = randomUUID();
    await db.execute(
      sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous)
          VALUES (${userId}::uuid, ${`auto-${userId.slice(0, 8)}@testfake.local`}, false, false)`,
    );
    await db.insert(profiles).values({ id: userId });
    const ensured = await ensureWeeklyProgram();
    weeklyProgramId = ensured.id;
    weeklyInsertedByTest = ensured.insertedByTest;
  });

  afterEach(async () => {
    await db.delete(profilePrograms).where(eq(profilePrograms.profileId, userId));
    if (weeklyInsertedByTest) {
      await db.delete(programs).where(eq(programs.id, weeklyProgramId));
    }
    await db.delete(profiles).where(eq(profiles.id, userId));
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`);
  });

  it("inserts a membership row for the auto-subscribe program", async () => {
    await autoSubscribeNewMember(userId);

    const rows = await db.select().from(profilePrograms).where(eq(profilePrograms.profileId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].programId).toBe(weeklyProgramId);
  });

  it("is idempotent across repeated calls (no duplicate rows)", async () => {
    await autoSubscribeNewMember(userId);
    await autoSubscribeNewMember(userId);

    const rows = await db.select().from(profilePrograms).where(eq(profilePrograms.profileId, userId));
    expect(rows).toHaveLength(1);
  });

  it("does not throw or re-subscribe when the program is missing — captures to Sentry instead", async () => {
    // Drop the program so the slug lookup misses. The function should
    // log to Sentry and return without inserting anything. After the
    // delete, the afterEach should not try to delete it again.
    await db.delete(programs).where(eq(programs.id, weeklyProgramId));
    weeklyInsertedByTest = false;

    const captureMock = vi.mocked(Sentry.captureException);
    captureMock.mockClear();

    await expect(autoSubscribeNewMember(userId)).resolves.toBeUndefined();

    expect(captureMock).toHaveBeenCalledOnce();
    const arg = captureMock.mock.calls[0][0];
    expect(arg).toBeInstanceOf(Error);
    expect((arg as Error).message).toMatch(/weekly-web-updates/);

    const rows = await db.select().from(profilePrograms).where(eq(profilePrograms.profileId, userId));
    expect(rows).toHaveLength(0);
  });
});
