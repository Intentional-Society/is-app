import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";

import { db } from "./db";
import { comments, profiles, reactions, wishes } from "./schema";

export type WishStatus = "active" | "archived" | "fulfilled";
export type WishReactionEmoji = "love" | "me_too" | "supportive" | "help";

export const REACTION_EMOJIS: { key: WishReactionEmoji; label: string; emoji: string }[] = [
  { key: "love", label: "Love it!", emoji: "❤️" },
  { key: "me_too", label: "Me too!", emoji: "🙌" },
  { key: "supportive", label: "Supportive", emoji: "🌟" },
  { key: "help", label: "Let me help!", emoji: "🤝" },
];

function isWishStatus(value: unknown): value is WishStatus {
  return value === "active" || value === "archived" || value === "fulfilled";
}

export function isWishReactionEmoji(value: unknown): value is WishReactionEmoji {
  return value === "love" || value === "me_too" || value === "supportive" || value === "help";
}

export function parseWishCreate(body: unknown): { title: string; description: string | null } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const obj = body as Record<string, unknown>;
  if (typeof obj.title !== "string" || !obj.title.trim()) {
    return { error: "title is required" };
  }
  const description =
    obj.description === undefined || obj.description === null
      ? null
      : typeof obj.description === "string"
        ? obj.description
        : null;
  return { title: obj.title.trim(), description };
}

export function parseWishUpdate(
  body: unknown,
): { title?: string; description?: string | null; status?: WishStatus } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const obj = body as Record<string, unknown>;
  const result: { title?: string; description?: string | null; status?: WishStatus } = {};

  if (obj.title !== undefined) {
    if (typeof obj.title !== "string" || !obj.title.trim()) {
      return { error: "title must be a non-empty string" };
    }
    result.title = obj.title.trim();
  }

  if (obj.description !== undefined) {
    if (obj.description !== null && typeof obj.description !== "string") {
      return { error: "description must be a string or null" };
    }
    result.description = obj.description as string | null;
  }

  if (obj.status !== undefined) {
    if (!isWishStatus(obj.status)) {
      return { error: "status must be active, archived, or fulfilled" };
    }
    result.status = obj.status;
  }

  if (Object.keys(result).length === 0) {
    return { error: "at least one field is required" };
  }

  return result;
}

export async function listMyWishes(authorId: string) {
  return db.select().from(wishes).where(eq(wishes.authorId, authorId)).orderBy(asc(wishes.createdAt));
}

export async function countActiveWishes(authorId: string): Promise<number> {
  const rows = await db
    .select({ id: wishes.id })
    .from(wishes)
    .where(and(eq(wishes.authorId, authorId), eq(wishes.status, "active")));
  return rows.length;
}

export async function createWish({
  authorId,
  title,
  description,
}: {
  authorId: string;
  title: string;
  description: string | null;
}) {
  const [wish] = await db.insert(wishes).values({ authorId, title, description }).returning();
  return { wish };
}

export async function updateWish({
  id,
  authorId,
  title,
  description,
  status,
}: {
  id: string;
  authorId: string;
  title?: string;
  description?: string | null;
  status?: WishStatus;
}) {
  const fields: Partial<typeof wishes.$inferInsert> = {};
  if (title !== undefined) fields.title = title;
  if (description !== undefined) fields.description = description;
  if (status !== undefined) fields.status = status;

  const [updated] = await db
    .update(wishes)
    .set(fields)
    .where(and(eq(wishes.id, id), eq(wishes.authorId, authorId)))
    .returning();
  if (!updated) return { error: "not_found" as const };
  return { wish: updated };
}

export async function deleteWish({ id, authorId }: { id: string; authorId: string }) {
  const [deleted] = await db
    .delete(wishes)
    .where(and(eq(wishes.id, id), eq(wishes.authorId, authorId)))
    .returning();
  if (!deleted) return { error: "not_found" as const };
  return { ok: true as const };
}

export async function listActiveWishesForMember(profileId: string) {
  return db
    .select()
    .from(wishes)
    .where(and(eq(wishes.authorId, profileId), eq(wishes.status, "active")))
    .orderBy(asc(wishes.createdAt));
}

// Returns up to 50 most recent active wishes from non-hidden, active members
// other than the current user, with author info.
export async function listAllActiveWishesForDiscover(excludeId: string) {
  return db
    .select({
      id: wishes.id,
      title: wishes.title,
      description: wishes.description,
      createdAt: wishes.createdAt,
      authorId: profiles.id,
      authorDisplayName: profiles.displayName,
      authorSlug: profiles.slug,
    })
    .from(wishes)
    .innerJoin(profiles, eq(wishes.authorId, profiles.id))
    .where(
      and(
        eq(wishes.status, "active"),
        ne(profiles.id, excludeId),
        eq(profiles.hidden, false),
        isNull(profiles.deactivatedAt),
      ),
    )
    .orderBy(desc(wishes.createdAt))
    .limit(50);
}

// Returns reaction counts per emoji and which ones the viewer has set.
export async function listWishReactions(wishId: string, viewerId: string) {
  const rows = await db
    .select({ emoji: reactions.emoji, authorId: reactions.authorId })
    .from(reactions)
    .where(and(eq(reactions.reactableType, "wishes"), eq(reactions.reactableId, wishId)));

  const counts: Record<WishReactionEmoji, number> = { love: 0, me_too: 0, supportive: 0, help: 0 };
  const mine = new Set<WishReactionEmoji>();
  for (const row of rows) {
    const key = row.emoji as WishReactionEmoji;
    counts[key] = (counts[key] ?? 0) + 1;
    if (row.authorId === viewerId) mine.add(key);
  }
  return { counts, mine: [...mine] };
}

// Toggle a reaction: add if absent, remove if present. Returns the new state.
export async function toggleWishReaction({
  wishId,
  authorId,
  emoji,
}: {
  wishId: string;
  authorId: string;
  emoji: WishReactionEmoji;
}) {
  const existing = await db
    .select({ id: reactions.id })
    .from(reactions)
    .where(
      and(
        eq(reactions.reactableType, "wishes"),
        eq(reactions.reactableId, wishId),
        eq(reactions.authorId, authorId),
        eq(reactions.emoji, emoji),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .delete(reactions)
      .where(
        and(
          eq(reactions.reactableType, "wishes"),
          eq(reactions.reactableId, wishId),
          eq(reactions.authorId, authorId),
          eq(reactions.emoji, emoji),
        ),
      );
    return { added: false };
  }
  await db.insert(reactions).values({ reactableType: "wishes", reactableId: wishId, authorId, emoji });
  return { added: true };
}

export async function listWishComments(wishId: string) {
  return db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      authorId: profiles.id,
      authorDisplayName: profiles.displayName,
      authorSlug: profiles.slug,
    })
    .from(comments)
    .innerJoin(profiles, eq(comments.authorId, profiles.id))
    .where(and(eq(comments.commentableType, "wishes"), eq(comments.commentableId, wishId)))
    .orderBy(asc(comments.createdAt));
}

export async function createWishComment({
  wishId,
  authorId,
  body,
}: {
  wishId: string;
  authorId: string;
  body: string;
}) {
  const [comment] = await db
    .insert(comments)
    .values({ commentableType: "wishes", commentableId: wishId, authorId, body })
    .returning();
  return { comment };
}

export async function deleteWishComment({ id, authorId }: { id: string; authorId: string }) {
  const [deleted] = await db
    .delete(comments)
    .where(and(eq(comments.id, id), eq(comments.authorId, authorId)))
    .returning();
  if (!deleted) return { error: "not_found" as const };
  return { ok: true as const };
}
