import { asc, count, eq, sql } from "drizzle-orm";

import { attachAvatarUrls } from "./avatars";
import { db } from "./db";
import { profiles } from "./schema";
import { E2E_EMAILS } from "./test-reset";

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

// Recipient list for the admin members page: every member who should
// receive mail — hidden profiles, deactivated profiles, and the seeded
// e2e accounts are excluded. Email lives on auth.users, which schema.ts
// maps only partially (id + email, for FKs), so the query is raw SQL —
// same approach as signins-admin.ts.
export const listActiveMemberEmails = async (): Promise<string[]> => {
  const e2eList = sql.join(
    E2E_EMAILS.map((e) => sql`${e}`),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    SELECT u.email
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE p.hidden = false
      AND p.deactivated_at IS NULL
      AND u.email NOT IN (${e2eList})
    ORDER BY lower(u.email), u.email
  `)) as unknown as { email: string }[];
  return rows.map((r) => r.email);
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
