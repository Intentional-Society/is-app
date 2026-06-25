import { asc, count, eq, sql } from "drizzle-orm";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { attachAvatarUrls, clearAvatar } from "./avatars";
import { db } from "./db";
import { invites, profiles } from "./schema";
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

// Permanently delete a member's account. Admin-only (the requireAdmin gate
// on the route is the authorization). Removes the avatar object, the
// profiles row — whose FK cascade clears program memberships, relations,
// and invite hints, and null-sets invite lineage (createdBy/redeemedBy) so
// the chain survives anonymized — then the auth.users row.
//
// Members remove themselves via deactivate, not here: refusing self-delete
// keeps an admin from stranding the app's admin-only state, and refusing to
// delete a fellow admin (demote first) guards the same, mirroring
// setAdminStatus.
export const deleteMemberAccount = async (
  targetId: string,
  requesterId: string,
): Promise<{ ok: true } | { error: "not_found" | "self_delete" | "is_admin" }> => {
  if (targetId === requesterId) return { error: "self_delete" };

  const [target] = await db
    .select({ id: profiles.id, isAdmin: profiles.isAdmin })
    .from(profiles)
    .where(eq(profiles.id, targetId));
  if (!target) return { error: "not_found" };
  if (target.isAdmin) return { error: "is_admin" };

  // Order matters: clearAvatar reads avatarPath off the profile, and the
  // profiles → auth.users FK is ON DELETE NO ACTION, so the profile (child)
  // must go before the auth user (parent). The profile delete is a single
  // statement, so its cascade runs without a multi-statement transaction
  // over the pooler (docs/strategy-db-transactions.md).
  await clearAvatar(targetId);

  // Clear the redemption pair on any invite this member redeemed before the
  // profile delete. The redeemed_by FK is ON DELETE SET NULL, but redeemed_at
  // has no FK, so the cascade alone would null one and leave the other —
  // violating the invites_redemption_pair check ((redeemed_by IS NULL) =
  // (redeemed_at IS NULL)) and aborting the whole DELETE. Since most members
  // join via an invite, without this no normally-onboarded member is
  // deletable. The invite reverts to unredeemed; its created_by survives.
  await db.update(invites).set({ redeemedBy: null, redeemedAt: null }).where(eq(invites.redeemedBy, targetId));

  await db.delete(profiles).where(eq(profiles.id, targetId));

  const { error } = await supabaseAdmin.auth.admin.deleteUser(targetId);
  // A 404 means the auth user is already gone — the end state we want — so
  // treat it as success (keeps the delete idempotent and tolerant of an
  // auth row that was never fully provisioned by GoTrue). Any other error is
  // a real failure; surface it, though the profile is already deleted.
  if (error && error.status !== 404) {
    throw new Error(`deleteMemberAccount: auth deleteUser failed for ${targetId}: ${error.message}`);
  }

  return { ok: true };
};
