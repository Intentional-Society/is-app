import { count, desc, eq } from "drizzle-orm";

import { db } from "./db";
import { profiles } from "./schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (s: string): boolean => UUID_RE.test(s);

export type AdminMember = {
  id: string;
  displayName: string | null;
  slug: string | null;
  avatarUrl: string | null;
  location: string | null;
  isAdmin: boolean;
  createdAt: string;
};

export const listAdminMembers = async (): Promise<AdminMember[]> => {
  const rows = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      slug: profiles.slug,
      avatarUrl: profiles.avatarUrl,
      location: profiles.location,
      isAdmin: profiles.isAdmin,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .orderBy(desc(profiles.createdAt));

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
};

export const setAdminStatus = async (
  targetId: string,
  isAdmin: boolean,
  requesterId: string,
): Promise<
  { ok: true } | { error: "not_found" | "self_demotion" | "last_admin" }
> => {
  if (!isValidUuid(targetId)) return { error: "not_found" };

  // Guard: cannot remove your own admin status
  if (!isAdmin && targetId === requesterId) return { error: "self_demotion" };

  const [target] = await db
    .select({ id: profiles.id, isAdmin: profiles.isAdmin })
    .from(profiles)
    .where(eq(profiles.id, targetId));
  if (!target) return { error: "not_found" };

  // Guard: cannot remove the last admin
  if (!isAdmin && target.isAdmin) {
    const [{ adminCount }] = await db
      .select({ adminCount: count() })
      .from(profiles)
      .where(eq(profiles.isAdmin, true));
    if (adminCount <= 1) return { error: "last_admin" };
  }

  await db.update(profiles).set({ isAdmin }).where(eq(profiles.id, targetId));
  return { ok: true };
};
