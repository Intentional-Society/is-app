import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";

import { MESSAGE_BOX_FEATURE, MESSAGE_BOX_MAX_LENGTH } from "@/lib/program-features";
import app from "@/server/api";
import { db } from "@/server/db";
import { deleteProgram } from "@/server/programs";
import {
  messageBoxMessages,
  messageBoxSettings,
  profilePrograms,
  profiles,
  programFeatures,
  programs,
} from "@/server/schema";
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

// A session for an admin row that is also a seeded e2e account. The account is
// flagged by email or by the e2e_account app_metadata claim; either one caps
// its admin powers (auth-middleware.ts).
const authAsE2EAdmin = (userId: string, via: "email" | "claim") => {
  mockCreateServerClient.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            ...fakeUser(userId),
            email: via === "email" ? E2E_EMAILS[1] : `${userId}@testfake.local`,
            app_metadata: via === "claim" ? { e2e_account: true } : {},
          } as User,
        },
        error: null,
      }),
    },
    // biome-ignore lint/suspicious/noExplicitAny: test mock shape
  } as any);
};

const insertUserAndProfile = async (
  id: string,
  opts: { isAdmin?: boolean; displayName?: string; hidden?: boolean; deactivated?: boolean } = {},
) => {
  await db.execute(
    sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${`${id}@testfake.local`}, false, false)`,
  );
  await db.insert(profiles).values({
    id,
    isAdmin: opts.isAdmin ?? false,
    displayName: opts.displayName ?? null,
    hidden: opts.hidden ?? false,
    deactivatedAt: opts.deactivated ? new Date() : null,
  });
};

const deleteUserAndProfile = async (id: string) => {
  await db.delete(profiles).where(eq(profiles.id, id));
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
};

type Box = {
  visibility: "members" | "admins";
  canRead: boolean;
  canPost: boolean;
  canModerate: boolean;
  messages: Array<{ id: string; body: string; author: { id: string; displayName: string | null } }>;
};

describe("Message box program feature", () => {
  let admin: string;
  let participant: string;
  let outsider: string;
  let programId: string;
  let createdProgramIds: string[];
  let createdUserIds: string[];

  const jsonInit = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const boxUrl = (id = programId) => `/api/programs/${id}/message-box`;
  const getBox = async (): Promise<Box> => (await app.request(boxUrl())).json() as Promise<Box>;
  const postMessage = (body: unknown, id = programId) => app.request(boxUrl(id), jsonInit("POST", body));

  const seedProgram = async (opts: { attached?: boolean; archived?: boolean } = {}): Promise<string> => {
    const id = randomUUID();
    await db.insert(programs).values({
      id,
      slug: `mb-${id.slice(0, 8)}`,
      name: "Message box test program",
      archivedAt: opts.archived ? new Date() : null,
    });
    if (opts.attached ?? true) {
      await db.insert(programFeatures).values({ programId: id, featureKey: MESSAGE_BOX_FEATURE });
    }
    createdProgramIds.push(id);
    return id;
  };

  const seedUser = async (opts: Parameters<typeof insertUserAndProfile>[1] = {}): Promise<string> => {
    const id = randomUUID();
    await insertUserAndProfile(id, opts);
    createdUserIds.push(id);
    return id;
  };

  const seedMessage = async (authorId: string, body = "hello", id = programId) => {
    const [row] = await db
      .insert(messageBoxMessages)
      .values({ programId: id, authorId, body })
      .returning({ id: messageBoxMessages.id });
    return row.id;
  };

  const setVisibilityDirect = (visibility: "members" | "admins", id = programId) =>
    db
      .insert(messageBoxSettings)
      .values({ programId: id, visibility })
      .onConflictDoUpdate({ target: messageBoxSettings.programId, set: { visibility } });

  beforeEach(async () => {
    createdProgramIds = [];
    createdUserIds = [];
    admin = await seedUser({ isAdmin: true });
    participant = await seedUser({ displayName: "Pat Participant" });
    outsider = await seedUser({ displayName: "Olive Outsider" });
    programId = await seedProgram();
    await db.insert(profilePrograms).values({ profileId: participant, programId });
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    if (createdProgramIds.length > 0) {
      // program_features, message_box_settings and message_box_messages cascade.
      await db.delete(profilePrograms).where(inArray(profilePrograms.programId, createdProgramIds));
      await db.delete(programs).where(inArray(programs.id, createdProgramIds));
    }
    for (const id of createdUserIds) await deleteUserAndProfile(id);
  });

  describe("access rule", () => {
    it("requires sign-in", async () => {
      authAs(null);
      expect((await app.request(boxUrl())).status).toBe(401);
      expect((await postMessage({ body: "hi" })).status).toBe(401);
    });

    it("404s when the feature isn't attached to the program", async () => {
      const unattached = await seedProgram({ attached: false });
      authAs(participant);
      expect((await app.request(boxUrl(unattached))).status).toBe(404);
      expect((await postMessage({ body: "hi" }, unattached)).status).toBe(404);
    });

    it("404s for an archived program", async () => {
      const archived = await seedProgram({ archived: true });
      authAs(admin);
      expect((await app.request(boxUrl(archived))).status).toBe(404);
    });

    it("404s for an unknown or malformed program id", async () => {
      authAs(participant);
      expect((await app.request(boxUrl(randomUUID()))).status).toBe(404);
      expect((await app.request(boxUrl("not-a-uuid"))).status).toBe(404);
    });

    it("stops a participant who left from posting", async () => {
      await db.update(profilePrograms).set({ leftAt: new Date() }).where(eq(profilePrograms.profileId, participant));
      await setVisibilityDirect("members");
      authAs(participant);
      const box = await getBox();
      // Still readable (visibility is "members") but no longer able to post.
      expect(box.canPost).toBe(false);
      expect((await postMessage({ body: "hi" })).status).toBe(403);
    });
  });

  describe("GET /api/programs/:id/message-box", () => {
    it("defaults to admins-only: a participant can post but not read", async () => {
      await seedMessage(participant, "secret");
      authAs(participant);
      const box = await getBox();
      expect(box).toMatchObject({ visibility: "admins", canRead: false, canPost: true, canModerate: false });
      expect(box.messages).toEqual([]);
    });

    it("lets an admin read under admins-only, with moderation on", async () => {
      await seedMessage(participant, "for admins");
      authAs(admin);
      const box = await getBox();
      expect(box).toMatchObject({ canRead: true, canPost: false, canModerate: true });
      expect(box.messages.map((m) => m.body)).toEqual(["for admins"]);
    });

    it("lets any signed-in member read when visibility is members, but not post or moderate", async () => {
      await setVisibilityDirect("members");
      await seedMessage(participant, "open to all");
      authAs(outsider);
      const box = await getBox();
      expect(box).toMatchObject({ visibility: "members", canRead: true, canPost: false, canModerate: false });
      expect(box.messages).toHaveLength(1);
      expect(box.messages[0]).toMatchObject({
        body: "open to all",
        author: { id: participant, displayName: "Pat Participant" },
      });
    });

    it.each(["email", "claim"] as const)(
      "treats the seeded e2e admin (flagged by %s) as a plain member: no admins-only messages, no hidden authors, no moderation",
      async (via) => {
        const hidden = await seedUser({ hidden: true, displayName: "Hidden" });
        await seedMessage(participant, "visible");
        await seedMessage(hidden, "from hidden");

        authAsE2EAdmin(admin, via);
        expect(await getBox()).toMatchObject({
          visibility: "admins",
          canRead: false,
          canModerate: false,
          messages: [],
        });

        await setVisibilityDirect("members");
        const box = await getBox();
        expect(box.canModerate).toBe(false);
        expect(box.messages.map((m) => m.body)).toEqual(["visible"]);
      },
    );

    it("returns newest messages first", async () => {
      await setVisibilityDirect("members");
      const first = await seedMessage(participant, "first");
      await db
        .update(messageBoxMessages)
        .set({ createdAt: new Date(Date.now() - 60_000) })
        .where(eq(messageBoxMessages.id, first));
      await seedMessage(participant, "second");
      authAs(participant);
      expect((await getBox()).messages.map((m) => m.body)).toEqual(["second", "first"]);
    });

    it("hides deactivated and hidden authors from members but not from admins", async () => {
      const deactivated = await seedUser({ deactivated: true, displayName: "Gone" });
      const hidden = await seedUser({ hidden: true, displayName: "Hidden" });
      await setVisibilityDirect("members");
      await seedMessage(participant, "visible");
      await seedMessage(deactivated, "from deactivated");
      await seedMessage(hidden, "from hidden");

      authAs(outsider);
      expect((await getBox()).messages.map((m) => m.body)).toEqual(["visible"]);

      authAs(admin);
      expect((await getBox()).messages).toHaveLength(3);
    });
  });

  describe("POST /api/programs/:id/message-box", () => {
    it("lets a participant post, trimming the text and recording the author", async () => {
      authAs(participant);
      const res = await postMessage({ body: "  Hello community  " });
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };
      const [row] = await db.select().from(messageBoxMessages).where(eq(messageBoxMessages.id, id));
      expect(row).toMatchObject({ body: "Hello community", authorId: participant, programId });
    });

    it("rejects a non-participant with 403 not_participant", async () => {
      authAs(outsider);
      const res = await postMessage({ body: "hi" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "not_participant" });
    });

    it("rejects a message from an admin who isn't a participant", async () => {
      authAs(admin);
      expect((await postMessage({ body: "hi" })).status).toBe(403);
    });

    it.each([
      ["a blank message", { body: "   " }],
      ["a missing body", {}],
      ["a non-string body", { body: 12 }],
      ["an over-long message", { body: "x".repeat(MESSAGE_BOX_MAX_LENGTH + 1) }],
    ])("rejects %s with 400", async (_label, payload) => {
      authAs(participant);
      expect((await postMessage(payload)).status).toBe(400);
    });

    it("accepts a message at exactly the length limit", async () => {
      authAs(participant);
      expect((await postMessage({ body: "x".repeat(MESSAGE_BOX_MAX_LENGTH) })).status).toBe(201);
    });
  });

  describe("admin moderation and settings", () => {
    const adminBox = (id = programId) => `/api/admin/programs/${id}/message-box`;

    it("lets an admin delete a message", async () => {
      const messageId = await seedMessage(participant);
      authAs(admin);
      const res = await app.request(`${adminBox()}/messages/${messageId}`, { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(await db.select().from(messageBoxMessages).where(eq(messageBoxMessages.id, messageId))).toEqual([]);
    });

    it("404s a delete from a non-admin, even the message's own author", async () => {
      const messageId = await seedMessage(participant);
      authAs(participant);
      const res = await app.request(`${adminBox()}/messages/${messageId}`, { method: "DELETE" });
      expect(res.status).toBe(404);
      expect(await db.select().from(messageBoxMessages).where(eq(messageBoxMessages.id, messageId))).toHaveLength(1);
    });

    it("only deletes a message through its own program", async () => {
      const other = await seedProgram();
      const messageId = await seedMessage(participant);
      authAs(admin);
      const res = await app.request(`${adminBox(other)}/messages/${messageId}`, { method: "DELETE" });
      expect(res.status).toBe(404);
      expect(await db.select().from(messageBoxMessages).where(eq(messageBoxMessages.id, messageId))).toHaveLength(1);
    });

    it("404s deleting a message that doesn't exist", async () => {
      authAs(admin);
      const res = await app.request(`${adminBox()}/messages/${randomUUID()}`, { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    it("reads the default visibility as admins", async () => {
      authAs(admin);
      const res = await app.request(adminBox());
      expect(await res.json()).toEqual({ visibility: "admins" });
    });

    it("sets visibility, which then governs who can read", async () => {
      authAs(admin);
      const patch = await app.request(adminBox(), jsonInit("PATCH", { visibility: "members" }));
      expect(patch.status).toBe(200);
      expect(await (await app.request(adminBox())).json()).toEqual({ visibility: "members" });

      await seedMessage(participant, "now public");
      authAs(outsider);
      expect((await getBox()).messages.map((m) => m.body)).toEqual(["now public"]);

      authAs(admin);
      await app.request(adminBox(), jsonInit("PATCH", { visibility: "admins" }));
      authAs(outsider);
      expect(await getBox()).toMatchObject({ canRead: false, messages: [] });
    });

    it("rejects an unknown visibility with 400", async () => {
      authAs(admin);
      const res = await app.request(adminBox(), jsonInit("PATCH", { visibility: "everyone" }));
      expect(res.status).toBe(400);
    });

    it("404s a visibility change from a non-admin or for an unknown program", async () => {
      authAs(participant);
      expect((await app.request(adminBox(), jsonInit("PATCH", { visibility: "members" }))).status).toBe(404);
      authAs(admin);
      expect((await app.request(adminBox(randomUUID()), jsonInit("PATCH", { visibility: "members" }))).status).toBe(
        404,
      );
    });
  });

  describe("attaching the feature", () => {
    const featuresUrl = (id = programId) => `/api/admin/programs/${id}/features`;

    it("lists every registry feature with its attached state", async () => {
      const bare = await seedProgram({ attached: false });
      authAs(admin);
      const attached = (await (await app.request(featuresUrl())).json()) as {
        features: Array<{ key: string; attached: boolean }>;
      };
      expect(attached.features).toContainEqual(expect.objectContaining({ key: MESSAGE_BOX_FEATURE, attached: true }));
      const unattached = (await (await app.request(featuresUrl(bare))).json()) as {
        features: Array<{ key: string; attached: boolean }>;
      };
      expect(unattached.features).toContainEqual(
        expect.objectContaining({ key: MESSAGE_BOX_FEATURE, attached: false }),
      );
    });

    it("turns the box on, idempotently, and off again", async () => {
      const bare = await seedProgram({ attached: false });
      authAs(admin);
      const put = () => app.request(`${featuresUrl(bare)}/${MESSAGE_BOX_FEATURE}`, { method: "PUT" });
      expect((await put()).status).toBe(200);
      expect((await put()).status).toBe(200);
      expect(await db.select().from(programFeatures).where(eq(programFeatures.programId, bare))).toHaveLength(1);
      expect((await app.request(boxUrl(bare))).status).toBe(200);

      const del = await app.request(`${featuresUrl(bare)}/${MESSAGE_BOX_FEATURE}`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect((await app.request(boxUrl(bare))).status).toBe(404);
    });

    it("keeps messages when the feature is turned off and on again", async () => {
      await seedMessage(participant, "survives");
      authAs(admin);
      await app.request(`${featuresUrl()}/${MESSAGE_BOX_FEATURE}`, { method: "DELETE" });
      await app.request(`${featuresUrl()}/${MESSAGE_BOX_FEATURE}`, { method: "PUT" });
      expect((await getBox()).messages.map((m) => m.body)).toEqual(["survives"]);
    });

    it("404s an unknown feature key or program, and any non-admin", async () => {
      authAs(admin);
      expect((await app.request(`${featuresUrl()}/not-a-feature`, { method: "PUT" })).status).toBe(404);
      expect((await app.request(`${featuresUrl(randomUUID())}/${MESSAGE_BOX_FEATURE}`, { method: "PUT" })).status).toBe(
        404,
      );
      authAs(participant);
      expect((await app.request(`${featuresUrl()}/${MESSAGE_BOX_FEATURE}`, { method: "DELETE" })).status).toBe(404);
      expect((await app.request(featuresUrl())).status).toBe(404);
    });
  });

  describe("program page data", () => {
    it("lists attached feature keys on GET /api/programs/by-slug/:slug", async () => {
      const bare = await seedProgram({ attached: false });
      const [withBox] = await db.select({ slug: programs.slug }).from(programs).where(eq(programs.id, programId));
      const [withoutBox] = await db.select({ slug: programs.slug }).from(programs).where(eq(programs.id, bare));

      authAs(outsider);
      const a = (await (await app.request(`/api/programs/by-slug/${withBox.slug}`)).json()) as {
        program: { features: string[] };
      };
      expect(a.program.features).toEqual([MESSAGE_BOX_FEATURE]);
      const b = (await (await app.request(`/api/programs/by-slug/${withoutBox.slug}`)).json()) as {
        program: { features: string[] };
      };
      expect(b.program.features).toEqual([]);
    });

    it("ignores attachment rows whose key left the registry", async () => {
      await db.insert(programFeatures).values({ programId, featureKey: "retired-feature" });
      const [row] = await db.select({ slug: programs.slug }).from(programs).where(eq(programs.id, programId));
      authAs(outsider);
      const body = (await (await app.request(`/api/programs/by-slug/${row.slug}`)).json()) as {
        program: { features: string[] };
      };
      expect(body.program.features).toEqual([MESSAGE_BOX_FEATURE]);
    });
  });

  describe("data lifecycle", () => {
    it("deletes a program's messages and settings with the program", async () => {
      const empty = await seedProgram();
      await seedMessage(participant, "bye", empty);
      await setVisibilityDirect("members", empty);

      expect(await deleteProgram(empty)).toEqual({ ok: true });
      expect(await db.select().from(messageBoxMessages).where(eq(messageBoxMessages.programId, empty))).toEqual([]);
      expect(await db.select().from(messageBoxSettings).where(eq(messageBoxSettings.programId, empty))).toEqual([]);
    });

    it("deletes a member's messages with their profile", async () => {
      const temp = await seedUser();
      await seedMessage(temp, "mine");
      await db.delete(profiles).where(eq(profiles.id, temp));
      expect(await db.select().from(messageBoxMessages).where(eq(messageBoxMessages.authorId, temp))).toEqual([]);
    });
  });
});
