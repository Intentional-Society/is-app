import { and, count, countDistinct, eq, gt, gte, isNotNull, isNull, lte, type SQL, sql } from "drizzle-orm";

import { db } from "./db";
import { invites, profilePrograms, profiles, relations } from "./schema";

// Launch — when the invite went out. The `sinceLaunch` block counts
// member *activity* (sign-ins, web, invites) from this instant: the
// existing base responding to the invite, which is what matters at
// launch, not newly-created accounts. Bump this one constant if the
// real send moment shifts.
const LAUNCH_DATE = new Date("2026-06-05T05:19:34Z");

// Read-only funnel over existing tables — no schema change, no event
// stream. Answers "how many signed up and how far did they get" from
// the state the app already records. The DB keeps last-touched, not
// history, so the sign-in figures are snapshots, not retention curves.
export type ActivityMetrics = {
  launchDate: string;
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
  // Activity since LAUNCH_DATE — each is "members who did X after launch"
  // (or, for invites, "invites whose create/redeem happened after
  // launch"), keyed off the relevant action timestamp.
  sinceLaunch: {
    signedIn: number;
    signedAgreements: number;
    setIntention: number;
    editedProfile: number;
    builtWeb: number;
    joinedProgram: number;
    invitesCreated: number;
    invitesRedeemed: number;
  };
};

// `hidden` flags admin test accounts; they're invisible everywhere
// member-facing, so the funnel excludes them too.
const visible = eq(profiles.hidden, false);
// A migration can leave currentIntention as "" rather than NULL, so an
// empty/whitespace value mustn't count as "set". btrim(NULL) is NULL,
// which also (correctly) fails the comparison.
const intentionSet = sql`btrim(${profiles.currentIntention}) <> ''`;

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

// Distinct visible members currently in ≥1 program; with `extra` adds a
// further predicate (e.g. assignedAt since launch).
const programMemberCount = async (extra?: SQL): Promise<number> => {
  const [row] = await db
    .select({ c: countDistinct(profilePrograms.profileId) })
    .from(profilePrograms)
    .innerJoin(profiles, eq(profiles.id, profilePrograms.profileId))
    .where(extra ? and(visible, extra) : visible);
  return row?.c ?? 0;
};

// auth.users isn't fully modelled in Drizzle (schema.ts maps id + email
// only, for FKs), so read last_sign_in_at with raw SQL — the same way
// test-reset.ts reaches the auth schema. ::int keeps count() off the
// bigint-as-string path postgres.js takes for int8. `threshold` is an
// SQL fragment (a relative `now() - interval` or the launch timestamp).
const signedInCount = async (threshold: SQL): Promise<number> => {
  const [row] = (await db.execute(sql`
    SELECT count(DISTINCT u.id)::int AS count
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE p.hidden = false
      AND u.last_sign_in_at >= ${threshold}
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
    slSignedIn,
    slSignedAgreements,
    slSetIntention,
    slEditedProfile,
    slBuiltWeb,
    slJoinedProgram,
    slInvitesCreated,
    slInvitesRedeemed,
  ] = await Promise.all([
    // ---- all-time members ----
    profileCount(),
    profileCount(gte(profiles.createdAt, sql`now() - interval '7 days'`)),
    profileCount(gte(profiles.createdAt, sql`now() - interval '30 days'`)),
    profileCount(isNotNull(profiles.deactivatedAt)),
    profileCount(isNotNull(profiles.lastSignedAgreements)),
    profileCount(intentionSet),
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
    programMemberCount(isNull(profilePrograms.leftAt)),
    signedInCount(sql`now() - interval '7 days'`),
    signedInCount(sql`now() - interval '30 days'`),
    // ---- all-time invites ----
    inviteCount(),
    inviteCount(isNotNull(invites.redeemedAt)),
    // pending / expired / revoked partition the un-redeemed invites; the
    // pending vs expired split matches countActiveInvitesForCreator in invites.ts.
    inviteCount(and(isNull(invites.redeemedAt), isNull(invites.revokedAt), gt(invites.expiresAt, sql`now()`))),
    inviteCount(and(isNull(invites.redeemedAt), isNull(invites.revokedAt), lte(invites.expiresAt, sql`now()`))),
    inviteCount(and(isNull(invites.redeemedAt), isNotNull(invites.revokedAt))),
    // ---- since launch (activity, not signups) ----
    // Bind the launch instant as an ISO string + explicit cast: a raw JS
    // Date param fails postgres-js's bind path (the typed query builder
    // serializes Dates for us, but db.execute doesn't).
    signedInCount(sql`${LAUNCH_DATE.toISOString()}::timestamptz`),
    profileCount(gte(profiles.lastSignedAgreements, LAUNCH_DATE)),
    profileCount(and(intentionSet, gte(profiles.intentionUpdatedAt, LAUNCH_DATE))),
    profileCount(gte(profiles.lastUpdatedProfile, LAUNCH_DATE)),
    profileCount(gte(profiles.lastUpdatedWeb, LAUNCH_DATE)),
    programMemberCount(gte(profilePrograms.assignedAt, LAUNCH_DATE)),
    inviteCount(gte(invites.createdAt, LAUNCH_DATE)),
    inviteCount(gte(invites.redeemedAt, LAUNCH_DATE)),
  ]);

  return {
    launchDate: LAUNCH_DATE.toISOString(),
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
    sinceLaunch: {
      signedIn: slSignedIn,
      signedAgreements: slSignedAgreements,
      setIntention: slSetIntention,
      editedProfile: slEditedProfile,
      builtWeb: slBuiltWeb,
      joinedProgram: slJoinedProgram,
      invitesCreated: slInvitesCreated,
      invitesRedeemed: slInvitesRedeemed,
    },
  };
};
