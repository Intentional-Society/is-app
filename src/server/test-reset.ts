import { inArray, sql } from "drizzle-orm";

import { db } from "./db";
import { invites, profiles } from "./schema";

// Two long-lived accounts seeded manually in prod Supabase (see
// docs/doc-supabase.md). E2E signs in as these via password instead of
// admin-provisioning a fresh user per run, so CI never needs the
// service-role key.
export const E2E_EMAILS = ["e2e-regular@testfake.local", "e2e-admin@testfake.local"] as const;

// One physical `profiles` row as it stands immediately after the reset
// writes. ctid/xmin pin the exact tuple and the txid that
// last wrote it; inRecovery/serverAddr/searchPath/backendPid describe
// the connection the read-back ran on. All of this exists to diagnose
// #149 — a read seeing a stale bio just after the reset commits — by
// separating a genuine stale read from a duplicate tuple, a replica,
// or a schema-resolution mismatch.
export type ResetProbeRow = {
  ctid: string;
  xmin: string;
  bio: string | null;
  updatedAt: string | null;
  inRecovery: boolean;
  searchPath: string;
  serverAddr: string | null;
  backendPid: number;
};

// Clears out everything a welcome/invites test might leave behind on
// the seeded users. isAdmin is preserved so the admin account keeps
// its flag across runs. auth.users is not touched — the password and
// row stay put so the next run can sign in again.
//
// After the writes, it reads every seeded profile back (see #149): the
// UPDATE's RETURNING reports which rows were touched, and a per-id
// SELECT of the physical tuple plus connection state lets the caller
// tell a genuine stale read apart from a duplicate tuple, a replica,
// or a schema-resolution mismatch.
export const resetE2EUsers = async (): Promise<{
  reset: number;
  // ids the UPDATE's RETURNING reported — one entry per row touched, so
  // a duplicated id surfaces here as a repeat.
  updatedIds: string[];
  // Post-commit read-back per seeded user. `rows` holds every physical
  // profile row for that id: length 0 means no profile row at all (fine
  // — no test has signed in as them yet this run), length > 1 means
  // duplicate tuples.
  profiles: { id: string; email: string; rows: ResetProbeRow[] }[];
}> => {
  const emailList = sql.join(
    E2E_EMAILS.map((e) => sql`${e}`),
    sql`, `,
  );
  const users = (await db.execute(sql`SELECT id, email FROM auth.users WHERE email IN (${emailList})`)) as unknown as {
    id: string;
    email: string;
  }[];
  if (users.length === 0) return { reset: 0, updatedIds: [], profiles: [] };
  const ids = users.map((u) => u.id);

  // Two separate autocommit statements rather than db.transaction:
  // delete-then-wipe needn't be atomic for a test reset, and a
  // multi-statement BEGIN/COMMIT over the Supabase transaction pooler
  // can have its writes silently dropped while still reporting success
  // (cf. supabase/supabase#43753) — the leading suspect for #149.
  await db.delete(invites).where(inArray(invites.createdBy, ids));
  const updated = await db
    .update(profiles)
    .set({
      displayName: null,
      slug: null,
      bio: null,
      lastUpdatedProfile: null,
      keywords: sql`'{}'::text[]`,
      location: null,
      supplementaryInfo: null,
      referredBy: null,
      referredByLegacy: null,
      avatarPath: null,
      emergencyContact: null,
      liveDesire: null,
      lastUpdatedWeb: null,
    })
    .where(inArray(profiles.id, ids))
    .returning({ id: profiles.id });
  const updatedIds = updated.map((r) => r.id);

  // Read each id back on a fresh pooled connection, post-commit. No
  // LIMIT, so a duplicate-tuple bug surfaces as rows.length > 1; ctid
  // and xmin pin the tuple and its writing txid; pg_is_in_recovery /
  // current_setting('search_path') / inet_server_addr characterise the
  // connection this read happened to land on.
  const profilesAfter = await Promise.all(
    users.map(async ({ id, email }) => {
      const probe = (await db.execute(sql`
        SELECT
          ctid::text AS ctid,
          xmin::text AS xmin,
          bio,
          updated_at::text AS "updatedAt",
          pg_is_in_recovery() AS "inRecovery",
          current_setting('search_path') AS "searchPath",
          inet_server_addr()::text AS "serverAddr",
          pg_backend_pid() AS "backendPid"
        FROM profiles
        WHERE id = ${id}::uuid
      `)) as unknown as ResetProbeRow[];
      return { id, email, rows: [...probe] };
    }),
  );

  return { reset: users.length, updatedIds, profiles: profilesAfter };
};
