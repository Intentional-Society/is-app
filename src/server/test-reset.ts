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

// The endpoint is gated two ways: it's absent in production even if a
// token happens to be set, and it requires a matching header otherwise.
// Preview and local both satisfy the VERCEL_ENV gate; CI supplies the
// token via GH Actions secret.
export const isResetEnabled = (): boolean =>
  process.env.VERCEL_ENV !== "production" && !!process.env.CI_RESET_TOKEN;

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

  await db.transaction(async (tx) => {
    await tx.delete(invites).where(inArray(invites.createdBy, ids));
    await tx
      .update(profiles)
      .set({
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
      })
      .where(inArray(profiles.id, ids));
  });

  return { reset: ids.length };
};
