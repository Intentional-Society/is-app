import { and, desc, eq, isNull, type SQL } from "drizzle-orm";

import {
  MESSAGE_BOX_MAX_LENGTH,
  MESSAGE_BOX_MAX_PROMPT_LENGTH,
  MESSAGE_BOX_VISIBILITIES,
  type MessageBoxVisibility,
} from "@/lib/program-features";

import { isUuid } from "./auth-middleware";
import { attachAvatarUrls } from "./avatars";
import { db } from "./db";
import { messageBoxMessages, messageBoxSettings, profiles, programs } from "./schema";

// Message box: a program-specific feature where participants leave short
// messages (docs/design-programs.md). Access checks live in
// program-features.ts; this module is the data layer.

// Newest first, capped. The box is read aloud and skimmed, not archived;
// pagination can come if a program ever needs it.
const MESSAGE_LIMIT = 100;

export const DEFAULT_VISIBILITY: MessageBoxVisibility = "admins";

export type MessageBoxMessage = {
  id: string;
  body: string;
  createdAt: string;
  // True when the viewer wrote it, so the client can offer Edit.
  mine: boolean;
  author: {
    id: string;
    slug: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
};

export const isVisibility = (v: unknown): v is MessageBoxVisibility =>
  typeof v === "string" && (MESSAGE_BOX_VISIBILITIES as readonly string[]).includes(v);

export const parseMessageBody = (body: unknown): { body: string } | { error: string } => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const text = (body as Record<string, unknown>).body;
  if (typeof text !== "string") return { error: "body must be a string" };
  const trimmed = text.trim();
  if (!trimmed) return { error: "message is empty" };
  if (trimmed.length > MESSAGE_BOX_MAX_LENGTH) {
    return { error: `message is too long (max ${MESSAGE_BOX_MAX_LENGTH} characters)` };
  }
  return { body: trimmed };
};

export type MessageBoxSettings = {
  visibility: MessageBoxVisibility;
  // Markdown shown above the textarea; null = none set.
  prompt: string | null;
};

export type MessageBoxSettingsUpdate = Partial<MessageBoxSettings>;

// Parses an admin settings update. Every key is optional but at least one must
// be present. A blank prompt clears it (null).
export const parseSettingsUpdate = (body: unknown): MessageBoxSettingsUpdate | { error: string } => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const obj = body as Record<string, unknown>;
  const update: MessageBoxSettingsUpdate = {};

  if ("visibility" in obj) {
    if (!isVisibility(obj.visibility)) return { error: 'visibility must be "members" or "admins"' };
    update.visibility = obj.visibility;
  }
  if ("prompt" in obj) {
    if (obj.prompt !== null && typeof obj.prompt !== "string") return { error: "prompt must be a string or null" };
    const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : "";
    if (prompt.length > MESSAGE_BOX_MAX_PROMPT_LENGTH) {
      return { error: `prompt is too long (max ${MESSAGE_BOX_MAX_PROMPT_LENGTH} characters)` };
    }
    update.prompt = prompt || null;
  }
  if (Object.keys(update).length === 0) return { error: "nothing to update" };
  return update;
};

export const getSettings = async (programId: string): Promise<MessageBoxSettings> => {
  const [row] = await db
    .select({ visibility: messageBoxSettings.visibility, prompt: messageBoxSettings.prompt })
    .from(messageBoxSettings)
    .where(eq(messageBoxSettings.programId, programId));
  return {
    visibility: row && isVisibility(row.visibility) ? row.visibility : DEFAULT_VISIBILITY,
    prompt: row?.prompt ?? null,
  };
};

// Upserts only the keys present, so changing the prompt leaves visibility alone
// (and the reverse). The insert side fills the rest with column defaults.
export const updateSettings = async (
  programId: string,
  update: MessageBoxSettingsUpdate,
): Promise<{ ok: true } | { error: "not_found" }> => {
  if (!isUuid(programId)) return { error: "not_found" };
  const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "not_found" };

  await db
    .insert(messageBoxSettings)
    .values({ programId, ...update })
    .onConflictDoUpdate({ target: messageBoxSettings.programId, set: update });
  return { ok: true };
};

// Newest messages with their authors. Non-admin viewers don't see messages
// from deactivated or hidden profiles (both are invisible to members
// everywhere else); admins see everything, so moderation can reach it.
export const listMessages = async (
  programId: string,
  viewer: { id: string; isAdmin: boolean },
): Promise<MessageBoxMessage[]> => {
  const conditions: SQL[] = [eq(messageBoxMessages.programId, programId)];
  if (!viewer.isAdmin) {
    conditions.push(isNull(profiles.deactivatedAt), eq(profiles.hidden, false));
  }

  const rows = await db
    .select({
      id: messageBoxMessages.id,
      body: messageBoxMessages.body,
      createdAt: messageBoxMessages.createdAt,
      authorId: profiles.id,
      authorSlug: profiles.slug,
      authorDisplayName: profiles.displayName,
      avatarPath: profiles.avatarPath,
    })
    .from(messageBoxMessages)
    .innerJoin(profiles, eq(profiles.id, messageBoxMessages.authorId))
    .where(and(...conditions))
    .orderBy(desc(messageBoxMessages.createdAt))
    .limit(MESSAGE_LIMIT);

  const withUrls = await attachAvatarUrls(rows);
  return withUrls.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    mine: r.authorId === viewer.id,
    author: { id: r.authorId, slug: r.authorSlug, displayName: r.authorDisplayName, avatarUrl: r.avatarUrl },
  }));
};

export const createMessage = async (input: {
  programId: string;
  authorId: string;
  body: string;
}): Promise<{ id: string }> => {
  const [row] = await db.insert(messageBoxMessages).values(input).returning({ id: messageBoxMessages.id });
  return { id: row.id };
};

// Admin moderation. Scoped to the program so an id from another program's
// box can't be removed through this one.
export const deleteMessage = async (
  programId: string,
  messageId: string,
): Promise<{ ok: true } | { error: "not_found" }> => {
  if (!isUuid(programId) || !isUuid(messageId)) return { error: "not_found" };
  const deleted = await db
    .delete(messageBoxMessages)
    .where(and(eq(messageBoxMessages.id, messageId), eq(messageBoxMessages.programId, programId)))
    .returning({ id: messageBoxMessages.id });
  return deleted.length > 0 ? { ok: true } : { error: "not_found" };
};

// Authors can rewrite their own message. Scoped to program and author, so a
// message that is someone else's, or from another program, answers not_found
// (nothing is revealed about whether it exists). createdAt stays, so an edit
// doesn't reorder the box; there is no "edited" marker.
export const updateMessage = async (input: {
  programId: string;
  messageId: string;
  authorId: string;
  body: string;
}): Promise<{ ok: true } | { error: "not_found" }> => {
  if (!isUuid(input.programId) || !isUuid(input.messageId)) return { error: "not_found" };
  const updated = await db
    .update(messageBoxMessages)
    .set({ body: input.body })
    .where(
      and(
        eq(messageBoxMessages.id, input.messageId),
        eq(messageBoxMessages.programId, input.programId),
        eq(messageBoxMessages.authorId, input.authorId),
      ),
    )
    .returning({ id: messageBoxMessages.id });
  return updated.length > 0 ? { ok: true } : { error: "not_found" };
};
