import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";

import { MESSAGE_BOX_FEATURE, MESSAGE_BOX_MAX_LENGTH, MESSAGE_BOX_MAX_PROMPT_LENGTH } from "@/lib/program-features";
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
  prompt: string | null;
  canRead: boolean;
  canPost: boolean;
  canModerate: boolean;
  messages: Array<{ id: string; body: string; mine: boolean; author: { id: string; displayName: string | null } }>;
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

  describe("PATCH /api/programs/:id/message-box/messages/:messageId (edit your own)", () => {
    const edit = (messageId: string, body: unknown, id = programId) =>
      app.request(`${boxUrl(id)}/messages/${messageId}`, jsonInit("PATCH", body));
    const bodyOf = async (messageId: string) =>
      (await db.select().from(messageBoxMessages).where(eq(messageBoxMessages.id, messageId)))[0];

    it("lets the author rewrite their message, trimmed, keeping its timestamp and place", async () => {
      const messageId = await seedMessage(participant, "first draft");
      const before = await bodyOf(messageId);
      authAs(participant);
      expect((await edit(messageId, { body: "  better draft  " })).status).toBe(200);
      const after = await bodyOf(messageId);
      expect(after.body).toBe("better draft");
      expect(after.createdAt).toEqual(before.createdAt);
      expect(after.authorId).toBe(participant);
    });

    it("404s editing someone else's message, and leaves it unchanged", async () => {
      const other = await seedUser({ displayName: "Other" });
      await db.insert(profilePrograms).values({ profileId: other, programId });
      const messageId = await seedMessage(other, "theirs");
      authAs(participant);
      expect((await edit(messageId, { body: "hijack" })).status).toBe(404);
      expect((await bodyOf(messageId)).body).toBe("theirs");
    });

    it("gives admins no right to edit another member's message", async () => {
      await db.insert(profilePrograms).values({ profileId: admin, programId });
      const messageId = await seedMessage(participant, "mine");
      authAs(admin);
      expect((await edit(messageId, { body: "admin edit" })).status).toBe(404);
      expect((await bodyOf(messageId)).body).toBe("mine");
    });

    it("403s an author who is no longer a participant", async () => {
      const messageId = await seedMessage(participant, "old");
      await db.update(profilePrograms).set({ leftAt: new Date() }).where(eq(profilePrograms.profileId, participant));
      authAs(participant);
      expect((await edit(messageId, { body: "new" })).status).toBe(403);
      expect((await bodyOf(messageId)).body).toBe("old");
    });

    it("only edits through the message's own program", async () => {
      const other = await seedProgram();
      await db.insert(profilePrograms).values({ profileId: participant, programId: other });
      const messageId = await seedMessage(participant, "here");
      authAs(participant);
      expect((await edit(messageId, { body: "there" }, other)).status).toBe(404);
      expect((await bodyOf(messageId)).body).toBe("here");
    });

    it.each([
      ["a blank message", { body: "  " }],
      ["a non-string body", { body: 3 }],
      ["an over-long message", { body: "x".repeat(MESSAGE_BOX_MAX_LENGTH + 1) }],
    ])("rejects %s with 400", async (_label, payload) => {
      const messageId = await seedMessage(participant, "keep");
      authAs(participant);
      expect((await edit(messageId, payload)).status).toBe(400);
      expect((await bodyOf(messageId)).body).toBe("keep");
    });

    it("404s a missing or malformed message id, and requires sign-in and the feature", async () => {
      authAs(participant);
      expect((await edit(randomUUID(), { body: "x" })).status).toBe(404);
      expect((await edit("not-a-uuid", { body: "x" })).status).toBe(404);
      const unattached = await seedProgram({ attached: false });
      expect((await edit(randomUUID(), { body: "x" }, unattached)).status).toBe(404);
      authAs(null);
      expect((await edit(randomUUID(), { body: "x" })).status).toBe(401);
    });

    it("marks only the viewer's own messages as mine", async () => {
      await setVisibilityDirect("members");
      await seedMessage(participant, "mine");
      await seedMessage(admin, "not mine");
      authAs(participant);
      const box = await getBox();
      expect(Object.fromEntries(box.messages.map((m) => [m.body, m.mine]))).toEqual({ mine: true, "not mine": false });
    });
  });

  describe("archiving (reversible moderation)", () => {
    const messageUrl = (messageId: string, id = programId) =>
      `/api/admin/programs/${id}/message-box/messages/${messageId}`;
    const archivedUrl = (id = programId) => `/api/admin/programs/${id}/message-box/archived`;
    const setArchived = (messageId: string, archived: unknown, id = programId) =>
      app.request(messageUrl(messageId, id), jsonInit("PATCH", { archived }));
    const getArchived = async () =>
      (await (await app.request(archivedUrl())).json()) as {
        messages: Array<{ id: string; body: string; archivedAt: string; author: { id: string } }>;
      };
    const row = async (messageId: string) =>
      (await db.select().from(messageBoxMessages).where(eq(messageBoxMessages.id, messageId)))[0];

    it("hides an archived message from the program page for everyone, admins included, but keeps the row", async () => {
      await setVisibilityDirect("members");
      const keep = await seedMessage(participant, "keep");
      const hide = await seedMessage(participant, "hide me");
      authAs(admin);
      expect((await setArchived(hide, true)).status).toBe(200);

      expect((await row(hide)).archivedAt).not.toBeNull();
      for (const viewer of [admin, participant, outsider]) {
        authAs(viewer);
        expect((await getBox()).messages.map((m) => m.id)).toEqual([keep]);
      }
    });

    it("lists archived messages for admins only, most recently archived first", async () => {
      const first = await seedMessage(participant, "first");
      const second = await seedMessage(participant, "second");
      authAs(admin);
      await setArchived(first, true);
      await db
        .update(messageBoxMessages)
        .set({ archivedAt: new Date(Date.now() - 60_000) })
        .where(eq(messageBoxMessages.id, first));
      await setArchived(second, true);

      const { messages } = await getArchived();
      expect(messages.map((m) => m.body)).toEqual(["second", "first"]);
      expect(messages[0].author.id).toBe(participant);
      expect(typeof messages[0].archivedAt).toBe("string");
    });

    it("returns the whole archive, past the 100-message cap of the live box", async () => {
      await setVisibilityDirect("members");
      await db.insert(messageBoxMessages).values(
        Array.from({ length: 105 }, (_, i) => ({
          programId,
          authorId: participant,
          body: `archived ${i}`,
          archivedAt: new Date(Date.now() - i * 1000),
        })),
      );
      await db
        .insert(messageBoxMessages)
        .values(Array.from({ length: 105 }, (_, i) => ({ programId, authorId: participant, body: `live ${i}` })));
      authAs(admin);
      expect((await getArchived()).messages).toHaveLength(105);
      // The program page still shows only the newest 100 live messages.
      expect((await getBox()).messages).toHaveLength(100);
    });

    it("includes archived messages from hidden and deactivated authors for admins", async () => {
      const hidden = await seedUser({ hidden: true });
      const id = await seedMessage(hidden, "from hidden");
      authAs(admin);
      await setArchived(id, true);
      expect((await getArchived()).messages.map((m) => m.body)).toEqual(["from hidden"]);
    });

    it("restores a message to the program page", async () => {
      await setVisibilityDirect("members");
      const id = await seedMessage(participant, "back again");
      authAs(admin);
      await setArchived(id, true);
      expect((await setArchived(id, false)).status).toBe(200);
      expect((await row(id)).archivedAt).toBeNull();
      expect((await getArchived()).messages).toEqual([]);
      expect((await getBox()).messages.map((m) => m.id)).toEqual([id]);
    });

    it("is idempotent: archiving twice keeps the first timestamp, restoring an unarchived message is a no-op", async () => {
      const id = await seedMessage(participant);
      authAs(admin);
      await setArchived(id, true);
      const first = (await row(id)).archivedAt;
      expect((await setArchived(id, true)).status).toBe(200);
      expect((await row(id)).archivedAt).toEqual(first);

      const other = await seedMessage(participant, "never archived");
      expect((await setArchived(other, false)).status).toBe(200);
      expect((await row(other)).archivedAt).toBeNull();
    });

    it("stops the author editing an archived message", async () => {
      const id = await seedMessage(participant, "original");
      authAs(admin);
      await setArchived(id, true);
      authAs(participant);
      const res = await app.request(`${boxUrl()}/messages/${id}`, jsonInit("PATCH", { body: "sneaky edit" }));
      expect(res.status).toBe(404);
      expect((await row(id)).body).toBe("original");
    });

    it("lets an admin delete an archived message for good", async () => {
      const id = await seedMessage(participant);
      authAs(admin);
      await setArchived(id, true);
      expect((await app.request(messageUrl(id), { method: "DELETE" })).status).toBe(200);
      expect(await row(id)).toBeUndefined();
    });

    it("404s non-admins on both the archive action and the archive list", async () => {
      const id = await seedMessage(participant);
      for (const viewer of [participant, outsider]) {
        authAs(viewer);
        expect((await setArchived(id, true)).status).toBe(404);
        expect((await app.request(archivedUrl())).status).toBe(404);
      }
      expect((await row(id)).archivedAt).toBeNull();
    });

    it("gives the capped e2e admin no archive powers", async () => {
      const id = await seedMessage(participant);
      authAsE2EAdmin(admin, "email");
      expect((await setArchived(id, true)).status).toBe(404);
      expect((await app.request(archivedUrl())).status).toBe(404);
      expect((await row(id)).archivedAt).toBeNull();
    });

    it("scopes the action to the message's own program, and 404s unknown ids", async () => {
      const other = await seedProgram();
      const id = await seedMessage(participant);
      authAs(admin);
      expect((await setArchived(id, true, other)).status).toBe(404);
      expect((await setArchived(randomUUID(), true)).status).toBe(404);
      expect((await setArchived("not-a-uuid", true)).status).toBe(404);
      expect((await row(id)).archivedAt).toBeNull();
    });

    it.each([
      ["a missing value", {}],
      ["a non-boolean", { archived: "yes" }],
    ])("rejects %s with 400", async (_label, payload) => {
      const id = await seedMessage(participant);
      authAs(admin);
      expect((await app.request(messageUrl(id), jsonInit("PATCH", payload))).status).toBe(400);
    });
  });

  describe("admin moderation and settings", () => {
    const adminBox = (id = programId) => `/api/admin/programs/${id}/message-box`;

    it("lets an admin delete an archived message", async () => {
      const messageId = await seedMessage(participant);
      await db.update(messageBoxMessages).set({ archivedAt: new Date() }).where(eq(messageBoxMessages.id, messageId));
      authAs(admin);
      const res = await app.request(`${adminBox()}/messages/${messageId}`, { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(await db.select().from(messageBoxMessages).where(eq(messageBoxMessages.id, messageId))).toEqual([]);
    });

    it("only deletes an archived message: deleting a visible one is a harmless 404, e.g. after another admin restored it", async () => {
      const messageId = await seedMessage(participant, "restored meanwhile");
      authAs(admin);
      const res = await app.request(`${adminBox()}/messages/${messageId}`, { method: "DELETE" });
      expect(res.status).toBe(404);
      expect(await db.select().from(messageBoxMessages).where(eq(messageBoxMessages.id, messageId))).toHaveLength(1);
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
      await db.update(messageBoxMessages).set({ archivedAt: new Date() }).where(eq(messageBoxMessages.id, messageId));
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
      expect(await res.json()).toEqual({ visibility: "admins", prompt: null });
    });

    it("sets visibility, which then governs who can read", async () => {
      authAs(admin);
      const patch = await app.request(adminBox(), jsonInit("PATCH", { visibility: "members" }));
      expect(patch.status).toBe(200);
      expect(await (await app.request(adminBox())).json()).toEqual({ visibility: "members", prompt: null });

      await seedMessage(participant, "now public");
      authAs(outsider);
      expect((await getBox()).messages.map((m) => m.body)).toEqual(["now public"]);

      authAs(admin);
      await app.request(adminBox(), jsonInit("PATCH", { visibility: "admins" }));
      authAs(outsider);
      expect(await getBox()).toMatchObject({ canRead: false, messages: [] });
    });

    describe("prompt", () => {
      const patch = (body: unknown) => app.request(adminBox(), jsonInit("PATCH", body));

      it("saves a trimmed prompt and shows it to every member, even one who can't read the messages", async () => {
        authAs(admin);
        expect((await patch({ prompt: "  Won't be there at the next call?  " })).status).toBe(200);
        expect(await (await app.request(adminBox())).json()).toEqual({
          visibility: "admins",
          prompt: "Won't be there at the next call?",
        });

        for (const viewer of [participant, outsider]) {
          authAs(viewer);
          expect(await getBox()).toMatchObject({ canRead: false, prompt: "Won't be there at the next call?" });
        }
      });

      it("changes the prompt without touching visibility, and the reverse", async () => {
        authAs(admin);
        await patch({ visibility: "members" });
        await patch({ prompt: "Hello" });
        expect(await (await app.request(adminBox())).json()).toEqual({ visibility: "members", prompt: "Hello" });
        await patch({ visibility: "admins" });
        expect(await (await app.request(adminBox())).json()).toEqual({ visibility: "admins", prompt: "Hello" });
      });

      it("clears the prompt when set to blank or null", async () => {
        authAs(admin);
        await patch({ prompt: "Hello" });
        await patch({ prompt: "   " });
        expect((await getBox()).prompt).toBeNull();
        await patch({ prompt: "Again" });
        await patch({ prompt: null });
        expect((await getBox()).prompt).toBeNull();
      });

      it("accepts a prompt at the length limit and rejects one over it", async () => {
        authAs(admin);
        expect((await patch({ prompt: "x".repeat(MESSAGE_BOX_MAX_PROMPT_LENGTH) })).status).toBe(200);
        expect((await patch({ prompt: "x".repeat(MESSAGE_BOX_MAX_PROMPT_LENGTH + 1) })).status).toBe(400);
      });

      it("rejects a non-string prompt and an empty update with 400", async () => {
        authAs(admin);
        expect((await patch({ prompt: 5 })).status).toBe(400);
        expect((await patch({})).status).toBe(400);
      });

      it("404s a prompt change from a non-admin", async () => {
        authAs(participant);
        expect((await patch({ prompt: "nope" })).status).toBe(404);
      });
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
