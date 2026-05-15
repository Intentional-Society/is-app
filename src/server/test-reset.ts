import { inArray, sql } from "drizzle-orm";

import { db } from "./db";
import { getProfileForSelf } from "./profiles";
import { invites, profiles } from "./schema";

// Two long-lived accounts seeded manually in prod Supabase (see
// docs/doc-supabase.md). E2E signs in as these via password instead of
// admin-provisioning a fresh user per run, so CI never needs the
// service-role key.
export const E2E_EMAILS = ["e2e-regular@testfake.local", "e2e-admin@testfake.local"] as const;

// Clears out everything a welcome/invites test might leave behind on
// the seeded users. isAdmin is preserved so the admin account keeps
// its flag across runs. auth.users is not touched — the password and
// row stay put so the next run can sign in again.
export const resetE2EUsers = async (): Promise<{
  reset: number;
  // Post-transaction read-back of each reset user, via the same query
  // the redirect gate uses (getProfileForSelf). Probe for #149: callers
  // assert bio === null here before signing in. If bio is already
  // non-null on this fresh read, the reset transaction didn't take; if
  // it reads null here but `/` still renders LoggedInHome, the gap is
  // read-after-write visibility on the next request, not the reset.
  profiles: { id: string; bio: string | null }[];
}> => {
  const emailList = sql.join(
    E2E_EMAILS.map((e) => sql`${e}`),
    sql`, `,
  );
  const rows = await db.execute(sql`SELECT id FROM auth.users WHERE email IN (${emailList})`);
  const ids = (rows as unknown as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return { reset: 0, profiles: [] };

  await db.transaction(async (tx) => {
    await tx.delete(invites).where(inArray(invites.createdBy, ids));
    await tx
      .update(profiles)
      .set({
        displayName: null,
        slug: null,
        bio: null,
        keywords: sql`'{}'::text[]`,
        location: null,
        supplementaryInfo: null,
        referredBy: null,
        referredByLegacy: null,
        avatarUrl: null,
        emergencyContact: null,
        liveDesire: null,
        lastUpdatedWeb: null,
      })
      .where(inArray(profiles.id, ids));
  });

  const profilesAfter = await Promise.all(
    ids.map(async (id) => ({ id, bio: (await getProfileForSelf(id))?.bio ?? null })),
  );

  return { reset: ids.length, profiles: profilesAfter };
};
