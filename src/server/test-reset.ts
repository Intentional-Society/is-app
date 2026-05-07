import { inArray, sql } from "drizzle-orm";

import { db } from "./db";
import { invites, profiles } from "./schema";

// Two long-lived accounts seeded manually in prod Supabase (see
// docs/doc-supabase.md). E2E signs in as these via password instead of
// admin-provisioning a fresh user per run, so CI never needs the
// service-role key.
export const E2E_EMAILS = [
  "e2e-regular@testfake.local",
  "e2e-admin@testfake.local",
] as const;

// Clears out everything a welcome/invites test might leave behind on
// the seeded users. isAdmin is preserved so the admin account keeps
// its flag across runs. auth.users is not touched — the password and
// row stay put so the next run can sign in again.
export const resetE2EUsers = async (): Promise<{ reset: number }> => {
  const emailList = sql.join(
    E2E_EMAILS.map((e) => sql`${e}`),
    sql`, `,
  );
  const rows = await db.execute(
    sql`SELECT id FROM auth.users WHERE email IN (${emailList})`,
  );
  const ids = (rows as unknown as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return { reset: 0 };

  const baseReset = {
    displayName: null,
    bio: null,
    keywords: sql`'{}'::text[]`,
    location: null,
    supplementaryInfo: null,
    referredBy: null,
    referredByLegacy: null,
    avatarUrl: null,
    emergencyContact: null,
    liveDesire: null,
  };

  // slug column may not exist before the migration runs on shared DBs.
  // Fall back to resetting without it so E2E reset still succeeds.
  await db.transaction(async (tx) => {
    await tx.delete(invites).where(inArray(invites.createdBy, ids));
    await tx
      .update(profiles)
      .set({ ...baseReset, slug: null })
      .where(inArray(profiles.id, ids))
      .catch(() =>
        tx.update(profiles).set(baseReset).where(inArray(profiles.id, ids))
      );
  });

  return { reset: ids.length };
};
