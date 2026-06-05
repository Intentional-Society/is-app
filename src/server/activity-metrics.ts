import { and, count, countDistinct, eq, gt, gte, isNotNull, isNull, lte, type SQL, sql } from "drizzle-orm";

import { db } from "./db";
import { invites, profilePrograms, profiles, relations } from "./schema";

// Read-only funnel over existing tables — no schema change, no event
// stream. Answers "how many signed up and how far did they get" from
// the state the app already records. The DB keeps last-touched, not
// history, so the sign-in figures are snapshots, not retention curves.
export type ActivityMetrics = {
  members: {
    // member-facing population — `hidden` admin test accounts excluded
    total: number;
    new7d: number;
    new30d: number;
    deactivated: number;
    // funnel stages — each is "members who have ever done X"
    signedAgreements: number;
    setIntention: number;
    updatedProfile: number;
    builtWeb: number;
    joinedProgram: number;
    // distinct members who signed in within the window, from
    // auth.users.last_sign_in_at — last *full* sign-in, not last visit. A
    // member on a live session refreshes their token without
    // re-authenticating, so this undercounts the still-logged-in active.
    signedIn7d: number;
    signedIn30d: number;
  };
  invites: {
    created: number;
    redeemed: number;
    pending: number;
    expired: number;
    revoked: number;
  };
};

const sevenDaysAgo = sql`now() - interval '7 days'`;
const thirtyDaysAgo = sql`now() - interval '30 days'`;
// `hidden` flags admin test accounts; they're invisible everywhere
// member-facing, so the funnel excludes them too.
const visible = eq(profiles.hidden, false);

const profileCount = async (extra?: SQL): Promise<number> => {
  const [row] = await db
    .select({ c: count() })
    .from(profiles)
    .where(extra ? and(visible, extra) : visible);
  return row?.c ?? 0;
};

const inviteCount = async (cond?: SQL): Promise<number> => {
  const query = db.select({ c: count() }).from(invites);
  const [row] = cond ? await query.where(cond) : await query;
  return row?.c ?? 0;
};

// auth.users isn't fully modelled in Drizzle (schema.ts maps id + email
// only, for FKs), so read last_sign_in_at with raw SQL — the same way
// test-reset.ts reaches the auth schema. ::int keeps count() off the
// bigint-as-string path postgres.js takes for int8.
const signedInWithin = async (days: number): Promise<number> => {
  const [row] = (await db.execute(sql`
    SELECT count(DISTINCT u.id)::int AS count
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE p.hidden = false
      AND u.last_sign_in_at >= now() - (${days} * interval '1 day')
  `)) as unknown as { count: number }[];
  return row?.count ?? 0;
};

export const getActivityMetrics = async (): Promise<ActivityMetrics> => {
  const [
    total,
    new7d,
    new30d,
    deactivated,
    signedAgreements,
    setIntention,
    updatedProfile,
    builtWeb,
    joinedProgram,
    signedIn7d,
    signedIn30d,
    invCreated,
    invRedeemed,
    invPending,
    invExpired,
    invRevoked,
  ] = await Promise.all([
    profileCount(),
    profileCount(gte(profiles.createdAt, sevenDaysAgo)),
    profileCount(gte(profiles.createdAt, thirtyDaysAgo)),
    profileCount(isNotNull(profiles.deactivatedAt)),
    profileCount(isNotNull(profiles.lastSignedAgreements)),
    profileCount(isNotNull(profiles.currentIntention)),
    profileCount(isNotNull(profiles.lastUpdatedProfile)),
    // builtWeb — distinct visible members with ≥1 real (non-hint)
    // relation. `value IS NOT NULL` is the non-hint marker (a check
    // constraint ties is_hint to a null value).
    db
      .select({ c: countDistinct(relations.relatorId) })
      .from(relations)
      .innerJoin(profiles, eq(profiles.id, relations.relatorId))
      .where(and(visible, isNotNull(relations.value)))
      .then((rows) => rows[0]?.c ?? 0),
    // joinedProgram — distinct visible members currently in ≥1 program
    // (leftAt null means the membership is still active).
    db
      .select({ c: countDistinct(profilePrograms.profileId) })
      .from(profilePrograms)
      .innerJoin(profiles, eq(profiles.id, profilePrograms.profileId))
      .where(and(visible, isNull(profilePrograms.leftAt)))
      .then((rows) => rows[0]?.c ?? 0),
    signedInWithin(7),
    signedInWithin(30),
    inviteCount(),
    inviteCount(isNotNull(invites.redeemedAt)),
    // pending / expired / revoked partition the un-redeemed invites; the
    // pending vs expired split matches countActiveInvitesForCreator in invites.ts.
    inviteCount(and(isNull(invites.redeemedAt), isNull(invites.revokedAt), gt(invites.expiresAt, sql`now()`))),
    inviteCount(and(isNull(invites.redeemedAt), isNull(invites.revokedAt), lte(invites.expiresAt, sql`now()`))),
    inviteCount(and(isNull(invites.redeemedAt), isNotNull(invites.revokedAt))),
  ]);

  return {
    members: {
      total,
      new7d,
      new30d,
      deactivated,
      signedAgreements,
      setIntention,
      updatedProfile,
      builtWeb,
      joinedProgram,
      signedIn7d,
      signedIn30d,
    },
    invites: {
      created: invCreated,
      redeemed: invRedeemed,
      pending: invPending,
      expired: invExpired,
      revoked: invRevoked,
    },
  };
};
