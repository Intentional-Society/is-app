import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";

import { db } from "./db";
import { profiles, wishes } from "./schema";

export type WishStatus = "active" | "archived" | "fulfilled";

function isWishStatus(value: unknown): value is WishStatus {
  return value === "active" || value === "archived" || value === "fulfilled";
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

// Returns up to 5 random non-hidden, active profiles (excluding the current
// user) that have at least one active wish. ORDER BY random() is adequate for
// a small membership.
export async function discoverWishes(excludeId: string) {
  return db
    .selectDistinct({
      id: profiles.id,
      displayName: profiles.displayName,
      avatarPath: profiles.avatarPath,
      slug: profiles.slug,
    })
    .from(profiles)
    .innerJoin(wishes, and(eq(wishes.authorId, profiles.id), eq(wishes.status, "active")))
    .where(and(ne(profiles.id, excludeId), eq(profiles.hidden, false), isNull(profiles.deactivatedAt)))
    .orderBy(sql`random()`)
    .limit(5);
}
