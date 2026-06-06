import { and, count, countDistinct, desc, eq, gt, isNotNull, isNull, lte, ne, type SQL, sql } from "drizzle-orm";

import { db } from "./db";
import { invites, profilePrograms, profiles, programs, relations } from "./schema";

// Read-only funnel over existing tables — no schema change, no event
// stream. Answers "how many members signed up and how far did they get"
// from the state the app already records. The DB keeps last-touched, not
// history, so the sign-in figures are snapshots, not retention curves.
//
// Member-facing (the /metrics page): nothing here may name a person
// except the members who redeemed an invite, who are part of the
// community. Inviter notes and pending-invite names are deliberately
// absent — they describe people who haven't joined and stay admin-only.
export type SystemMetrics = {
  members: {
    // Active member population: `hidden` admin test accounts and
    // deactivated members both excluded. `deactivated` reports the latter
    // as a separate count alongside the Total Members figure.
    total: number;
    deactivated: number;
    // Onboarding funnel — each is "active members who have ever done X",
    // so all share `total` as their denominator and can't exceed it.
    signedAgreements: number;
    updatedProfile: number;
    builtWeb: number;
    setIntention: number;
    joinedProgram: number;
    // Activity windows. new* count sign-ups by created_at; signedIn*
    // count distinct members by auth.users.last_sign_in_at — last *full*
    // sign-in, not last visit, so a member on a live session who only
    // refreshes their token is undercounted.
    new7d: number;
    new30d: number;
    signedIn7d: number;
    signedIn30d: number;
  };
  invites: {
    created: number;
    redeemed: number;
    pending: number;
    expired: number;
    revoked: number;
    // Display names of the members who joined by redeeming an invite,
    // newest first — surfaced behind a "?" on the Redeemed row. Hidden
    // test accounts are excluded, so `redeemed` counts only invites whose
    // redeemer is a visible member.
    redeemedNames: { id: string; name: string | null }[];
  };
};

// `hidden` flags admin test accounts; they're invisible everywhere
// member-facing, so the funnel excludes them too. `notDeactivated` adds
// the second half of the base population shared by Total Members and
// every onboarding row.
const visible = eq(profiles.hidden, false);
const notDeactivated = isNull(profiles.deactivatedAt);

// Weekly Web Updates is the default newsletter, not a chosen cohort, so a
// member who belongs to nothing else doesn't count as "in a program".
const WEEKLY_WEB_SLUG = "weekly-web-updates";

const inviteCount = async (cond?: SQL): Promise<number> => {
  const query = db.select({ c: count() }).from(invites);
  const [row] = cond ? await query.where(cond) : await query;
  return row?.c ?? 0;
};

export const getSystemMetrics = async (): Promise<SystemMetrics> => {
  const [memberAgg, builtWeb, joinedProgram, signins, invCreated, redeemedNames, invPending, invExpired, invRevoked] =
    await Promise.all([
      // One scan over profiles covers Total Members, the deactivated
      // count, the onboarding funnel, and the sign-up windows — a
      // count(*) FILTER per column. Every funnel filter repeats
      // `deactivated_at IS NULL` so they share Total Members as a base.
      db
        .select({
          total: sql<number>`count(*) filter (where ${profiles.deactivatedAt} is null)`.mapWith(Number),
          deactivated: sql<number>`count(*) filter (where ${profiles.deactivatedAt} is not null)`.mapWith(Number),
          signedAgreements:
            sql<number>`count(*) filter (where ${profiles.deactivatedAt} is null and ${profiles.lastSignedAgreements} is not null)`.mapWith(
              Number,
            ),
          updatedProfile:
            sql<number>`count(*) filter (where ${profiles.deactivatedAt} is null and ${profiles.lastUpdatedProfile} is not null)`.mapWith(
              Number,
            ),
          // Intention counts non-blank only — IS NOT NULL alone would
          // count a member who opened the field then cleared it back to "".
          setIntention:
            sql<number>`count(*) filter (where ${profiles.deactivatedAt} is null and btrim(${profiles.currentIntention}) <> '')`.mapWith(
              Number,
            ),
          new7d:
            sql<number>`count(*) filter (where ${profiles.deactivatedAt} is null and ${profiles.createdAt} >= now() - interval '7 days')`.mapWith(
              Number,
            ),
          new30d:
            sql<number>`count(*) filter (where ${profiles.deactivatedAt} is null and ${profiles.createdAt} >= now() - interval '30 days')`.mapWith(
              Number,
            ),
        })
        .from(profiles)
        .where(visible)
        .then((rows) => rows[0]),
      // builtWeb — distinct active members with ≥1 real (non-hint)
      // relation. `value IS NOT NULL` is the non-hint marker (a check
      // constraint ties is_hint to a null value).
      db
        .select({ c: countDistinct(relations.relatorId) })
        .from(relations)
        .innerJoin(profiles, eq(profiles.id, relations.relatorId))
        .where(and(visible, notDeactivated, isNotNull(relations.value)))
        .then((rows) => rows[0]?.c ?? 0),
      // joinedProgram — distinct active members currently in ≥1 program
      // other than Weekly Web Updates (leftAt null = still a member).
      db
        .select({ c: countDistinct(profilePrograms.profileId) })
        .from(profilePrograms)
        .innerJoin(profiles, eq(profiles.id, profilePrograms.profileId))
        .innerJoin(programs, eq(programs.id, profilePrograms.programId))
        .where(and(visible, notDeactivated, isNull(profilePrograms.leftAt), ne(programs.slug, WEEKLY_WEB_SLUG)))
        .then((rows) => rows[0]?.c ?? 0),
      // Both sign-in windows in one pass over auth.users. That table
      // isn't fully modelled in Drizzle (schema.ts maps id + email only,
      // for FKs), so read last_sign_in_at with raw SQL — the same way
      // test-reset.ts reaches the auth schema. ::int keeps count() off the
      // bigint-as-string path postgres.js takes for int8.
      db
        .execute(sql`
          SELECT
            count(DISTINCT u.id) FILTER (WHERE u.last_sign_in_at >= now() - interval '7 days')::int AS in7,
            count(DISTINCT u.id) FILTER (WHERE u.last_sign_in_at >= now() - interval '30 days')::int AS in30
          FROM auth.users u
          JOIN public.profiles p ON p.id = u.id
          WHERE p.hidden = false AND p.deactivated_at IS NULL
        `)
        .then((rows) => (rows as unknown as { in7: number; in30: number }[])[0]),
      inviteCount(),
      // redeemed — the display names of members who joined via an invite,
      // newest first. Joining to profiles excludes invites redeemed by a
      // hidden test account, so the count tracks real members only.
      db
        .select({ id: invites.id, name: profiles.displayName })
        .from(invites)
        .innerJoin(profiles, eq(profiles.id, invites.redeemedBy))
        .where(and(isNotNull(invites.redeemedAt), visible))
        .orderBy(desc(invites.redeemedAt)),
      // pending / expired / revoked partition the un-redeemed invites; the
      // pending vs expired split matches countActiveInvitesForCreator in
      // invites.ts. Pending names stay admin-only, so only the count ships.
      inviteCount(and(isNull(invites.redeemedAt), isNull(invites.revokedAt), gt(invites.expiresAt, sql`now()`))),
      inviteCount(and(isNull(invites.redeemedAt), isNull(invites.revokedAt), lte(invites.expiresAt, sql`now()`))),
      inviteCount(and(isNull(invites.redeemedAt), isNotNull(invites.revokedAt))),
    ]);

  return {
    members: {
      total: memberAgg?.total ?? 0,
      deactivated: memberAgg?.deactivated ?? 0,
      signedAgreements: memberAgg?.signedAgreements ?? 0,
      updatedProfile: memberAgg?.updatedProfile ?? 0,
      builtWeb,
      setIntention: memberAgg?.setIntention ?? 0,
      joinedProgram,
      new7d: memberAgg?.new7d ?? 0,
      new30d: memberAgg?.new30d ?? 0,
      signedIn7d: signins?.in7 ?? 0,
      signedIn30d: signins?.in30 ?? 0,
    },
    invites: {
      created: invCreated,
      redeemed: redeemedNames.length,
      pending: invPending,
      expired: invExpired,
      revoked: invRevoked,
      redeemedNames,
    },
  };
};
