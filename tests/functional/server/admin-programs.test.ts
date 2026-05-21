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
import { profilePrograms, profiles, programs } from "@/server/schema";

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

describe("Admin programs API", () => {
  let admin: string;
  let nonAdmin: string;
  let member: string;
  // Programs created during a test (seeded or via the API) — torn down
  // in afterEach so each test starts from a clean slate.
  let createdProgramIds: string[];

  const trackProgram = (id: string) => {
    createdProgramIds.push(id);
    return id;
  };

  // Seeds a program directly. The slug defaults to a random value so
  // independent seeds never collide; pass an explicit slug when a test
  // needs to exercise the derived-slug uniqueness check.
  const seedProgram = async (name: string, slug?: string): Promise<string> => {
    const id = randomUUID();
    await db.insert(programs).values({ id, slug: slug ?? `seed-${id.slice(0, 8)}`, name });
    return trackProgram(id);
  };

  beforeEach(async () => {
    admin = randomUUID();
    nonAdmin = randomUUID();
    member = randomUUID();
    createdProgramIds = [];
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(nonAdmin);
    await insertUserAndProfile(member, { displayName: "Morgan Member" });
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    if (createdProgramIds.length > 0) {
      await db.delete(profilePrograms).where(inArray(profilePrograms.programId, createdProgramIds));
      await db.delete(programs).where(inArray(programs.id, createdProgramIds));
    }
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(nonAdmin);
    await deleteUserAndProfile(member);
  });

  describe("GET /api/admin/programs", () => {
    it("lists programs with member counts for an admin", async () => {
      const programId = await seedProgram("Listed Program");
      await db.insert(profilePrograms).values({ profileId: member, programId });

      authAs(admin);
      const res = await app.request("/api/admin/programs");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { programs: Array<{ id: string; memberCount: number }> };
      const own = body.programs.find((p) => p.id === programId);
      expect(own?.memberCount).toBe(1);
    });

    it("returns 404 for a non-admin", async () => {
      authAs(nonAdmin);
      const res = await app.request("/api/admin/programs");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/admin/programs", () => {
    const post = (body: unknown) =>
      app.request("/api/admin/programs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    it("stores the name and slug as separate, admin-chosen values", async () => {
      authAs(admin);
      const res = await post({ name: "Deep Work Cohort", slug: "dw-2026", description: "Focus time." });
      expect(res.status).toBe(201);

      const body = (await res.json()) as { program: { id: string; slug: string; name: string } };
      trackProgram(body.program.id);
      expect(body.program.name).toBe("Deep Work Cohort");
      expect(body.program.slug).toBe("dw-2026");
    });

    it("rejects a blank name with 400", async () => {
      authAs(admin);
      const res = await post({ name: "   ", slug: "blank-name" });
      expect(res.status).toBe(400);
    });

    it("rejects a missing slug with 400", async () => {
      authAs(admin);
      const res = await post({ name: "No Slug Program" });
      expect(res.status).toBe(400);
    });

    it("rejects a slug with invalid characters with 400", async () => {
      authAs(admin);
      const res = await post({ name: "Bad Slug Program", slug: "Not A Slug!" });
      expect(res.status).toBe(400);
    });

    it("returns 409 when the slug collides with an existing program", async () => {
      authAs(admin);
      const first = await post({ name: "Mentorship", slug: "mentorship" });
      const firstBody = (await first.json()) as { program: { id: string } };
      trackProgram(firstBody.program.id);

      const second = await post({ name: "Mentorship Two", slug: "mentorship" });
      expect(second.status).toBe(409);
      expect((await second.json()) as { error: string }).toEqual({ error: "slug_conflict" });
    });

    it("returns 404 for a non-admin", async () => {
      authAs(nonAdmin);
      const res = await post({ name: "Should Not Exist", slug: "should-not-exist" });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/admin/programs/:id", () => {
    it("returns program detail with its participants", async () => {
      const programId = await seedProgram("Detailed Program");
      await db.insert(profilePrograms).values({ profileId: member, programId });

      authAs(admin);
      const res = await app.request(`/api/admin/programs/${programId}`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        program: { id: string; participants: Array<{ id: string; displayName: string | null }> };
      };
      expect(body.program.id).toBe(programId);
      expect(body.program.participants).toHaveLength(1);
      expect(body.program.participants[0]).toMatchObject({ id: member, displayName: "Morgan Member" });
    });

    it("returns 404 for a non-existent program", async () => {
      authAs(admin);
      const res = await app.request(`/api/admin/programs/${randomUUID()}`);
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/admin/programs/:id", () => {
    const patch = (id: string, body: unknown) =>
      app.request(`/api/admin/programs/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    it("updates name, slug, and description independently", async () => {
      const programId = await seedProgram("Old Name");

      authAs(admin);
      const res = await patch(programId, {
        name: "New Name",
        slug: "renamed-slug",
        description: "Updated.",
      });
      expect(res.status).toBe(200);

      const [row] = await db
        .select({ name: programs.name, slug: programs.slug, description: programs.description })
        .from(programs)
        .where(eq(programs.id, programId));
      expect(row).toMatchObject({ name: "New Name", slug: "renamed-slug", description: "Updated." });
    });

    it("rejects a slug with invalid characters with 400", async () => {
      const programId = await seedProgram("Slug Validation Program");

      authAs(admin);
      const res = await patch(programId, { slug: "Has Spaces" });
      expect(res.status).toBe(400);
    });

    it("returns 409 when a new slug collides with another program's slug", async () => {
      await seedProgram("Slug Holder", "taken-slug");
      const programId = await seedProgram("Slug Mover");

      authAs(admin);
      const res = await patch(programId, { slug: "taken-slug" });
      expect(res.status).toBe(409);
    });

    it("returns 404 for a non-existent program", async () => {
      authAs(admin);
      const res = await patch(randomUUID(), { name: "Whatever" });
      expect(res.status).toBe(404);
    });

    it("archives and unarchives via the boolean toggle, stamping archived_at", async () => {
      const programId = await seedProgram("Archivable Program");
      authAs(admin);

      let res = await patch(programId, { archived: true });
      expect(res.status).toBe(200);
      let [row] = await db
        .select({ archivedAt: programs.archivedAt })
        .from(programs)
        .where(eq(programs.id, programId));
      expect(row.archivedAt).not.toBeNull();

      res = await patch(programId, { archived: false });
      expect(res.status).toBe(200);
      [row] = await db
        .select({ archivedAt: programs.archivedAt })
        .from(programs)
        .where(eq(programs.id, programId));
      expect(row.archivedAt).toBeNull();
    });

    it("opens and closes signups via the signupsOpen boolean", async () => {
      // New programs default to signups closed — flip open, then closed
      // again to exercise both directions.
      const programId = await seedProgram("Toggleable Signups Program");
      authAs(admin);

      let res = await patch(programId, { signupsOpen: true });
      expect(res.status).toBe(200);
      let [row] = await db
        .select({ signupsOpen: programs.signupsOpen })
        .from(programs)
        .where(eq(programs.id, programId));
      expect(row.signupsOpen).toBe(true);

      res = await patch(programId, { signupsOpen: false });
      expect(res.status).toBe(200);
      [row] = await db
        .select({ signupsOpen: programs.signupsOpen })
        .from(programs)
        .where(eq(programs.id, programId));
      expect(row.signupsOpen).toBe(false);
    });

    it("rejects a non-boolean archived or signupsOpen with 400", async () => {
      const programId = await seedProgram("Type Strict Program");
      authAs(admin);

      let res = await patch(programId, { archived: "yes" });
      expect(res.status).toBe(400);
      res = await patch(programId, { signupsOpen: 1 });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/admin/programs (archive/signups state)", () => {
    it("includes archived programs in the admin listing", async () => {
      const liveId = await seedProgram("Live Program");
      const archivedId = await seedProgram("Archived Program");
      await db.update(programs).set({ archivedAt: sql`now()` }).where(eq(programs.id, archivedId));

      authAs(admin);
      const res = await app.request("/api/admin/programs");
      const body = (await res.json()) as {
        programs: Array<{ id: string; archivedAt: string | null; signupsOpen: boolean }>;
      };

      const live = body.programs.find((p) => p.id === liveId);
      const archived = body.programs.find((p) => p.id === archivedId);
      expect(live).toBeDefined();
      expect(archived).toBeDefined();
      expect(archived?.archivedAt).not.toBeNull();
      expect(live?.archivedAt).toBeNull();
      // New programs are seeded without specifying signups_open, so they
      // pick up the closed-by-default policy.
      expect(live?.signupsOpen).toBe(false);
    });
  });

  describe("DELETE /api/admin/programs/:id", () => {
    const del = (id: string) => app.request(`/api/admin/programs/${id}`, { method: "DELETE" });

    it("deletes a program that has no participants", async () => {
      const programId = await seedProgram("Disposable Program");

      authAs(admin);
      const res = await del(programId);
      expect(res.status).toBe(200);

      const rows = await db.select().from(programs).where(eq(programs.id, programId));
      expect(rows).toHaveLength(0);
    });

    it("returns 409 and leaves the program intact when it has participants", async () => {
      const programId = await seedProgram("Occupied Program");
      await db.insert(profilePrograms).values({ profileId: member, programId });

      authAs(admin);
      const res = await del(programId);
      expect(res.status).toBe(409);
      expect((await res.json()) as { error: string }).toEqual({ error: "has_participants" });

      // The program and the enrollment both survive a rejected delete.
      const rows = await db.select().from(programs).where(eq(programs.id, programId));
      expect(rows).toHaveLength(1);
      const enrolled = await db
        .select()
        .from(profilePrograms)
        .where(eq(profilePrograms.programId, programId));
      expect(enrolled).toHaveLength(1);
    });

    it("deletes a program whose only members have already left", async () => {
      // Past memberships shouldn't block deletion — only currently-
      // joined ones do. The FK cascade cleans up the history rows.
      const programId = await seedProgram("Vacated Program");
      await db.insert(profilePrograms).values({ profileId: member, programId, leftAt: new Date() });

      authAs(admin);
      const res = await del(programId);
      expect(res.status).toBe(200);

      const rows = await db.select().from(programs).where(eq(programs.id, programId));
      expect(rows).toHaveLength(0);
    });

    it("returns 404 for a non-existent program", async () => {
      authAs(admin);
      const res = await del(randomUUID());
      expect(res.status).toBe(404);
    });

    it("returns 404 for a non-admin", async () => {
      const programId = await seedProgram("Guarded Delete Program");

      authAs(nonAdmin);
      const res = await del(programId);
      expect(res.status).toBe(404);

      // The guard rejects before any delete runs.
      const rows = await db.select().from(programs).where(eq(programs.id, programId));
      expect(rows).toHaveLength(1);
    });
  });

  describe("POST /api/admin/programs/:id/participants", () => {
    const addParticipant = (programId: string, profileId: string) =>
      app.request(`/api/admin/programs/${programId}/participants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId }),
      });

    it("adds a participant", async () => {
      const programId = await seedProgram("Joinable Program");

      authAs(admin);
      const res = await addParticipant(programId, member);
      expect(res.status).toBe(200);

      const rows = await db
        .select()
        .from(profilePrograms)
        .where(eq(profilePrograms.programId, programId));
      expect(rows).toHaveLength(1);
      expect(rows[0].profileId).toBe(member);
    });

    it("returns 409 when the member is already a participant", async () => {
      const programId = await seedProgram("Already Joined Program");
      await db.insert(profilePrograms).values({ profileId: member, programId });

      authAs(admin);
      const res = await addParticipant(programId, member);
      expect(res.status).toBe(409);
      expect((await res.json()) as { error: string }).toEqual({ error: "already_member" });
    });

    it("returns 404 when the profile does not exist", async () => {
      const programId = await seedProgram("Phantom Member Program");

      authAs(admin);
      const res = await addParticipant(programId, randomUUID());
      expect(res.status).toBe(404);
      expect((await res.json()) as { error: string }).toEqual({ error: "profile_not_found" });
    });

    it("returns 404 when the program does not exist", async () => {
      authAs(admin);
      const res = await addParticipant(randomUUID(), member);
      expect(res.status).toBe(404);
      expect((await res.json()) as { error: string }).toEqual({ error: "program_not_found" });
    });
  });

  describe("DELETE /api/admin/programs/:id/participants/:profileId", () => {
    it("soft-removes a participant by stamping left_at", async () => {
      const programId = await seedProgram("Removable Program");
      await db.insert(profilePrograms).values({ profileId: member, programId });

      authAs(admin);
      const res = await app.request(`/api/admin/programs/${programId}/participants/${member}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      // The row still exists but is marked left so the original
      // assignedAt is available for any future re-add.
      const rows = await db
        .select()
        .from(profilePrograms)
        .where(eq(profilePrograms.programId, programId));
      expect(rows).toHaveLength(1);
      expect(rows[0].leftAt).not.toBeNull();
    });

    it("re-adding a previously-left member restores membership and preserves the original assignedAt", async () => {
      const programId = await seedProgram("Re-Addable Program");
      await db.insert(profilePrograms).values({ profileId: member, programId });

      const [original] = await db
        .select()
        .from(profilePrograms)
        .where(eq(profilePrograms.programId, programId));
      const originalAssignedAt = original.assignedAt;

      authAs(admin);
      // Remove (soft-deletes)
      let res = await app.request(`/api/admin/programs/${programId}/participants/${member}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      // Re-add — the existing row's leftAt clears, assignedAt is unchanged.
      res = await app.request(`/api/admin/programs/${programId}/participants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: member }),
      });
      expect(res.status).toBe(200);

      const [after] = await db
        .select()
        .from(profilePrograms)
        .where(eq(profilePrograms.programId, programId));
      expect(after.leftAt).toBeNull();
      expect(after.assignedAt.getTime()).toBe(originalAssignedAt.getTime());
    });

    it("returns 404 when the member is not a participant", async () => {
      const programId = await seedProgram("Empty Program");

      authAs(admin);
      const res = await app.request(`/api/admin/programs/${programId}/participants/${member}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for a non-admin", async () => {
      const programId = await seedProgram("Guarded Program");
      await db.insert(profilePrograms).values({ profileId: member, programId });

      authAs(nonAdmin);
      const res = await app.request(`/api/admin/programs/${programId}/participants/${member}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });
  });
});
