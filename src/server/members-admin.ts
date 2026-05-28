import { asc, count, eq } from "drizzle-orm";

import { attachAvatarUrls } from "./avatars";
import { db } from "./db";
import { profiles } from "./schema";

export type AdminMember = {
  id: string;
  displayName: string | null;
  slug: string | null;
  avatarUrl: string | null;
  location: string | null;
  isAdmin: boolean;
  createdAt: string;
};

export const listMembersAdmin = async (): Promise<AdminMember[]> => {
  const rows = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      slug: profiles.slug,
      avatarPath: profiles.avatarPath,
      location: profiles.location,
      isAdmin: profiles.isAdmin,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .orderBy(asc(profiles.displayName), asc(profiles.id));

  const withUrls = await attachAvatarUrls(rows);
  return withUrls.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
};

export const setAdminStatus = async (
  targetId: string,
  isAdmin: boolean,
  requesterId: string,
): Promise<{ ok: true } | { error: "not_found" | "self_demotion" | "last_admin" }> => {
  if (!isAdmin && targetId === requesterId) return { error: "self_demotion" };

  const [target] = await db
    .select({ id: profiles.id, isAdmin: profiles.isAdmin })
    .from(profiles)
    .where(eq(profiles.id, targetId));
  if (!target) return { error: "not_found" };

  // Guard: at least one admin must remain. The count check and update are
  // separate statements (transactions over the pooler are unreliable — see
  // docs/strategy-db-transactions.md), so two concurrent demotions could
  // theoretically both pass. Acceptable given IS's small, trusted admin set.
  if (!isAdmin && target.isAdmin) {
    const [{ adminCount }] = await db.select({ adminCount: count() }).from(profiles).where(eq(profiles.isAdmin, true));
    if (adminCount <= 1) return { error: "last_admin" };
  }

  await db.update(profiles).set({ isAdmin }).where(eq(profiles.id, targetId));
  return { ok: true };
};
