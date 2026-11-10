import { eq, inArray, sql } from "drizzle-orm";

import { type WelcomeStep, welcomeEntryStep } from "@/lib/welcomeEntryStep";

import { db } from "./db";
import { invites, profiles } from "./schema";

// The long-lived e2e accounts, seeded by hand in prod Supabase (see
// docs/doc-supabase.md) and by scripts/seed-e2e-users.mjs locally. E2E
// signs in as these with a password instead of admin-provisioning a
// fresh user per run, so CI never needs the service-role key. The key
// is how a test names an account to the reset endpoint; the endpoint
// accepts no other target, which keeps its writes on these rows.
export const E2E_ACCOUNTS = {
  regular: "e2e-regular@testfake.local",
  admin: "e2e-admin@testfake.local",
} as const;

export type E2EAccountKey = keyof typeof E2E_ACCOUNTS;

export const E2E_ACCOUNT_KEYS = Object.keys(E2E_ACCOUNTS) as E2EAccountKey[];

export const E2E_EMAILS: readonly string[] = Object.values(E2E_ACCOUNTS);

// The state a reset leaves an account in.
//   fresh     — no welcome markers and an empty profile: the next visit
//               to `/` enters the welcome flow at its first step.
//   onboarded — the three welcome markers stamped and a minimal profile
//               saved, as if the member had just finished the welcome
//               flow. `/` renders the signed-in home page.
export type E2EResetState = "fresh" | "onboarded";

export type E2EResetRequest = { accounts: E2EAccountKey[]; state: E2EResetState };

// Bio the onboarded state writes. The reset reports it back as
// `expectedBio` so the e2e tripwire can tell this write from a bio
// left over from before the reset.
const ONBOARDED_BIO = "Seeded by the e2e reset.";

const onboardedDisplayName = (key: E2EAccountKey): string => `E2E ${key[0].toUpperCase()}${key.slice(1)}`;

// Reads the reset endpoint's JSON body. Every field is optional: no
// body resets every account to fresh.
export const parseResetRequest = (body: unknown): E2EResetRequest | { error: string } => {
  if (body === undefined || body === null) return { accounts: E2E_ACCOUNT_KEYS, state: "fresh" };
  if (typeof body !== "object" || Array.isArray(body)) return { error: "body must be a JSON object" };
  const { account, state } = body as { account?: unknown; state?: unknown };

  if (account !== undefined && !E2E_ACCOUNT_KEYS.includes(account as E2EAccountKey)) {
    return { error: `account must be one of: ${E2E_ACCOUNT_KEYS.join(", ")}` };
  }
  if (state !== undefined && state !== "fresh" && state !== "onboarded") {
    return { error: "state must be one of: fresh, onboarded" };
  }
  return {
    accounts: account === undefined ? E2E_ACCOUNT_KEYS : [account as E2EAccountKey],
    state: (state as E2EResetState | undefined) ?? "fresh",
  };
};

// One physical `profiles` row as it stands immediately after the reset
// writes. ctid/xmin pin the exact tuple and the txid that
// last wrote it; inRecovery/serverAddr/searchPath/backendPid describe
// the connection the read-back ran on. When the e2e tripwire fires
// (a row that doesn't match what the reset wrote — the #149
// write-loss/clobber shape), these separate a genuine stale read from
// a duplicate tuple, a replica, or a schema-resolution mismatch.
export type ResetReadBackRow = {
  ctid: string;
  xmin: string;
  bio: string | null;
  lastSignedAgreements: string | null;
  lastUpdatedProfile: string | null;
  lastReviewedPrograms: string | null;
  updatedAt: string | null;
  inRecovery: boolean;
  searchPath: string;
  serverAddr: string | null;
  backendPid: number;
};

export type ResetAccountResult = {
  account: E2EAccountKey;
  id: string;
  email: string;
  // What this reset wrote for the account.
  state: E2EResetState;
  expectedBio: string | null;
  // The welcome flow's own verdict on the row read back: the first
  // unfinished step, or null when onboarding is done. Null as well when
  // there is no row to judge.
  welcomeStep: WelcomeStep | null;
  // Every physical profile row for the id. Length 0 means no profile
  // row at all (the account has never signed in on this database);
  // length > 1 means duplicate tuples.
  rows: ResetReadBackRow[];
};

// Puts the named e2e accounts into a known state: deletes their invites
// and rewrites their profile to `fresh` or `onboarded`. isAdmin is
// preserved so the admin account keeps its flag across runs, and hidden
// is forced on so a test account never shows in a member-facing view.
// auth.users is not touched — the password and row stay put so the next
// run can sign in again.
//
// After the writes, it reads each profile back for the e2e tripwire in
// tests/e2e/helpers/session.ts: the UPDATE's RETURNING reports which
// rows were touched, and a per-id SELECT of the physical tuple plus
// connection state lets the caller tell a genuine stale read apart from
// a duplicate tuple, a replica, or a schema-resolution mismatch.
export const resetE2EUsers = async (
  request: E2EResetRequest = { accounts: E2E_ACCOUNT_KEYS, state: "fresh" },
): Promise<{
  reset: number;
  // ids the UPDATEs' RETURNING reported — one entry per row touched, so
  // a duplicated id surfaces here as a repeat.
  updatedIds: string[];
  accounts: ResetAccountResult[];
}> => {
  const emailToKey = new Map<string, E2EAccountKey>(request.accounts.map((key) => [E2E_ACCOUNTS[key], key]));
  const emailList = sql.join(
    [...emailToKey.keys()].map((e) => sql`${e}`),
    sql`, `,
  );
  const users = (await db.execute(sql`SELECT id, email FROM auth.users WHERE email IN (${emailList})`)) as unknown as {
    id: string;
    email: string;
  }[];
  if (users.length === 0) return { reset: 0, updatedIds: [], accounts: [] };
  const targets = users.map((u) => ({ id: u.id, email: u.email, key: emailToKey.get(u.email) as E2EAccountKey }));

  // Separate autocommit statements rather than db.transaction: the
  // reset needn't be atomic, and a multi-statement BEGIN/COMMIT over
  // the Supabase transaction pooler was observed here (May 2026, #149
  // bug 1; cf. supabase/supabase#43753) silently dropping its writes
  // while still reporting success. The statements touch different rows,
  // so they run concurrently.
  const wipe = {
    displayName: null,
    slug: null,
    bio: null,
    lastSignedAgreements: null,
    lastUpdatedProfile: null,
    lastReviewedPrograms: null,
    keywords: sql`'{}'::text[]`,
    location: null,
    supplementaryInfo: null,
    referredBy: null,
    referredByLegacy: null,
    avatarPath: null,
    emergencyContact: null,
    lastUpdatedWeb: null,
    currentIntention: null,
    intentionUpdatedAt: null,
    deactivatedAt: null,
    hidden: true,
  };
  const [, updates] = await Promise.all([
    db.delete(invites).where(
      inArray(
        invites.createdBy,
        targets.map((t) => t.id),
      ),
    ),
    Promise.all(
      targets.map((t) =>
        db
          .update(profiles)
          .set(
            request.state === "onboarded"
              ? {
                  ...wipe,
                  displayName: onboardedDisplayName(t.key),
                  // Each account's own slug, so two accounts onboarded
                  // side by side never contend for one.
                  slug: `e2e-${t.key}`,
                  bio: ONBOARDED_BIO,
                  lastSignedAgreements: sql`now()`,
                  lastUpdatedProfile: sql`now()`,
                  lastReviewedPrograms: sql`now()`,
                }
              : wipe,
          )
          .where(eq(profiles.id, t.id))
          .returning({ id: profiles.id }),
      ),
    ),
  ]);
  const updatedIds = updates.flat().map((r) => r.id);

  // Read each id back on a fresh pooled connection, post-commit. No
  // LIMIT, so a duplicate-tuple bug surfaces as rows.length > 1; ctid
  // and xmin pin the tuple and its writing txid; pg_is_in_recovery /
  // current_setting('search_path') / inet_server_addr characterise the
  // connection this read happened to land on.
  const accounts = await Promise.all(
    targets.map(async ({ id, email, key }): Promise<ResetAccountResult> => {
      const rows = (await db.execute(sql`
        SELECT
          ctid::text AS ctid,
          xmin::text AS xmin,
          bio,
          last_signed_agreements::text AS "lastSignedAgreements",
          last_updated_profile::text AS "lastUpdatedProfile",
          last_reviewed_programs::text AS "lastReviewedPrograms",
          updated_at::text AS "updatedAt",
          pg_is_in_recovery() AS "inRecovery",
          current_setting('search_path') AS "searchPath",
          inet_server_addr()::text AS "serverAddr",
          pg_backend_pid() AS "backendPid"
        FROM profiles
        WHERE id = ${id}::uuid
      `)) as unknown as ResetReadBackRow[];
      return {
        account: key,
        id,
        email,
        state: request.state,
        expectedBio: request.state === "onboarded" ? ONBOARDED_BIO : null,
        welcomeStep: welcomeEntryStep(rows[0] ?? null),
        rows: [...rows],
      };
    }),
  );

  return { reset: users.length, updatedIds, accounts };
};
