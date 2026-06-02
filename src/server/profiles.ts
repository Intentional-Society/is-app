import type { User } from "@supabase/supabase-js";
import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm";

import { isUuid } from "./auth-middleware";
import { attachAvatarUrls } from "./avatars";
import { db } from "./db";
import { authUsers, profiles } from "./schema";

// avatarUrl is intentionally absent: the avatar is set through the
// dedicated upload endpoint (POST /api/me/avatar), not as free-text
// here. The column it maps to is `avatarPath`, a Storage object path.
export const EDITABLE_PROFILE_FIELDS = [
  "displayName",
  "bio",
  "keywords",
  "location",
  "supplementaryInfo",
  "emergencyContact",
  "currentIntention",
] as const;

type EditableField = (typeof EDITABLE_PROFILE_FIELDS)[number];

export type EditableProfileInput = Partial<{
  displayName: string | null;
  bio: string | null;
  keywords: string[];
  location: string | null;
  supplementaryInfo: string | null;
  emergencyContact: string | null;
  currentIntention: string | null;
}>;

const isNullableString = (v: unknown): v is string | null => v === null || typeof v === "string";

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

// Returns the sanitized update payload, or a string describing the
// first validation failure. Unknown keys are treated as failures to
// protect fields like isAdmin / referredBy from being set via the
// editable endpoint.
export const parseEditableProfile = (body: unknown): EditableProfileInput | { error: string } => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }

  const input = body as Record<string, unknown>;
  const out: EditableProfileInput = {};

  for (const key of Object.keys(input)) {
    if (!(EDITABLE_PROFILE_FIELDS as readonly string[]).includes(key)) {
      return { error: `unknown or non-editable field: ${key}` };
    }
  }

  for (const key of EDITABLE_PROFILE_FIELDS) {
    if (!(key in input)) continue;
    const value = input[key];
    if (key === "keywords") {
      if (!isStringArray(value)) {
        return { error: "keywords must be an array of strings" };
      }
      out.keywords = [...new Set(value)];
    } else {
      if (!isNullableString(value)) {
        return { error: `${key} must be a string or null` };
      }
      out[key as Exclude<EditableField, "keywords">] = value;
    }
  }

  return out;
};

export const toSlug = (displayName: string): string =>
  displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// Returns { created: true } only when a brand-new profile row was
// inserted. Callers (notably /auth/callback) use this to gate
// once-per-member side effects like auto-subscribing to the weekly web
// update — DO NOTHING returns no rows on conflict, so a non-empty
// RETURNING means "this was a first-time sign-in".
export const upsertProfile = async (user: User): Promise<{ created: boolean }> => {
  const displayName = (user.user_metadata?.displayName as string | undefined) ?? null;
  const slug = displayName ? toSlug(displayName) : null;

  const rows = await db
    .insert(profiles)
    .values({ id: user.id, displayName, slug })
    .onConflictDoNothing({ target: profiles.id })
    .returning({ id: profiles.id });

  return { created: rows.length > 0 };
};

export type ProfileForSelf = {
  id: string;
  displayName: string | null;
  bio: string | null;
  keywords: string[];
  location: string | null;
  supplementaryInfo: string | null;
  referredBy: string | null;
  referredByLegacy: string | null;
  avatarUrl: string | null;
  emergencyContact: string | null;
  currentIntention: string | null;
  intentionUpdatedAt: Date | null;
  isAdmin: boolean;
  lastSignedAgreements: Date | null;
  lastUpdatedProfile: Date | null;
  lastReviewedPrograms: Date | null;
  lastUpdatedWeb: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export const getProfileForSelf = async (userId: string): Promise<ProfileForSelf | null> => {
  const [row] = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      bio: profiles.bio,
      keywords: profiles.keywords,
      location: profiles.location,
      supplementaryInfo: profiles.supplementaryInfo,
      referredBy: profiles.referredBy,
      referredByLegacy: profiles.referredByLegacy,
      avatarPath: profiles.avatarPath,
      emergencyContact: profiles.emergencyContact,

      currentIntention: profiles.currentIntention,
      intentionUpdatedAt: profiles.intentionUpdatedAt,
      isAdmin: profiles.isAdmin,
      lastSignedAgreements: profiles.lastSignedAgreements,
      lastUpdatedProfile: profiles.lastUpdatedProfile,
      lastReviewedPrograms: profiles.lastReviewedPrograms,
      lastUpdatedWeb: profiles.lastUpdatedWeb,
      createdAt: profiles.createdAt,
      updatedAt: profiles.updatedAt,
    })
    .from(profiles)
    .where(eq(profiles.id, userId));

  if (!row) return null;
  const [profile] = await attachAvatarUrls([row]);
  return profile;
};

// MVCC + connection metadata captured alongside a profile read. Logged
// at the GET /me call site when the `x-debug-timing` debug header is
// on, to diagnose #149: a welcome-flow read intermittently sees an
// older snapshot of the same row a moments-earlier read saw populated.
// xmin pins the txid of the visible tuple — different xmin across two
// reads of the same row identifies a stale-snapshot read; inRecovery /
// serverAddr / backendPid describe the Postgres backend the read
// landed on, so we can tell whether requests scatter across Supavisor
// backends or stick. Remove once #149 is closed.
export type ProfileReadProbe = {
  ctid: string;
  xmin: string;
  inRecovery: boolean;
  serverAddr: string | null;
  backendPid: number;
};

// Same SELECT as getProfileForSelf with the probe columns appended in
// the same statement so the metadata unambiguously describes the
// connection that served *this* read. Production GET /me still uses
// the plain variant; this one runs only when the debug header is set.
export const getProfileForSelfWithProbe = async (
  userId: string,
): Promise<{ profile: ProfileForSelf | null; probe: ProfileReadProbe | null }> => {
  const [row] = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      bio: profiles.bio,
      keywords: profiles.keywords,
      location: profiles.location,
      supplementaryInfo: profiles.supplementaryInfo,
      referredBy: profiles.referredBy,
      referredByLegacy: profiles.referredByLegacy,
      avatarPath: profiles.avatarPath,
      emergencyContact: profiles.emergencyContact,

      currentIntention: profiles.currentIntention,
      intentionUpdatedAt: profiles.intentionUpdatedAt,
      isAdmin: profiles.isAdmin,
      lastSignedAgreements: profiles.lastSignedAgreements,
      lastUpdatedProfile: profiles.lastUpdatedProfile,
      lastReviewedPrograms: profiles.lastReviewedPrograms,
      lastUpdatedWeb: profiles.lastUpdatedWeb,
      createdAt: profiles.createdAt,
      updatedAt: profiles.updatedAt,
      __ctid: sql<string>`ctid::text`,
      __xmin: sql<string>`xmin::text`,
      __inRecovery: sql<boolean>`pg_is_in_recovery()`,
      __serverAddr: sql<string | null>`inet_server_addr()::text`,
      __backendPid: sql<number>`pg_backend_pid()`,
    })
    .from(profiles)
    .where(eq(profiles.id, userId));

  if (!row) {
    // No row — capture connection identity from a separate metadata
    // query so callers still get backend info for missing-profile
    // requests. May land on a different backend than the missing read.
    const [meta] = (await db.execute(sql`
      SELECT pg_is_in_recovery() AS "inRecovery",
             inet_server_addr()::text AS "serverAddr",
             pg_backend_pid() AS "backendPid"
    `)) as unknown as { inRecovery: boolean; serverAddr: string | null; backendPid: number }[];
    return {
      profile: null,
      probe: meta ? { ctid: "", xmin: "", ...meta } : null,
    };
  }

  const { __ctid, __xmin, __inRecovery, __serverAddr, __backendPid, ...rest } = row;
  const [profile] = await attachAvatarUrls([rest]);
  return {
    profile,
    probe: {
      ctid: __ctid,
      xmin: __xmin,
      inRecovery: __inRecovery,
      serverAddr: __serverAddr,
      backendPid: __backendPid,
    },
  };
};

// Bumps lastUpdatedWeb to now() on the user's profile. The Done button
// at the bottom of /myweb is the only caller — clicking it captures
// "I'm done updating my relations for now" and surfaces the user in
// other members' "recently active" suggestion source.
export const markWebUpdated = async (userId: string): Promise<void> => {
  await db.update(profiles).set({ lastUpdatedWeb: sql`now()` }).where(eq(profiles.id, userId));
};

// Stamps the agreements step of the welcome flow as done. The "I agree"
// button on /welcome/agreements is the only caller.
export const markAgreementsSigned = async (userId: string): Promise<void> => {
  await db.update(profiles).set({ lastSignedAgreements: sql`now()` }).where(eq(profiles.id, userId));
};

// Stamps the programs step of the welcome flow as done. The "Done"
// button on /welcome/programs is the only caller.
export const markProgramsReviewed = async (userId: string): Promise<void> => {
  await db.update(profiles).set({ lastReviewedPrograms: sql`now()` }).where(eq(profiles.id, userId));
};

export type ProfileForMember = {
  id: string;
  slug: string | null;
  displayName: string | null;
  bio: string | null;
  keywords: string[];
  location: string | null;
  supplementaryInfo: string | null;
  avatarUrl: string | null;
  email: string | null;
  currentIntention: string | null;
  intentionUpdatedAt: Date | null;
  createdAt: Date;
};

// Accepts either a UUID or a slug so /members/aria-chen and
// /members/<uuid> both work. UUID-shaped strings go straight to the id
// column; anything else is treated as a slug lookup.
// includeHidden=true bypasses the profiles.hidden filter so admins can
// view hidden test accounts; the API handler decides which to pass.
export const getProfileForMember = async (
  idOrSlug: string,
  options: { includeHidden?: boolean } = {},
): Promise<ProfileForMember | null> => {
  const match = isUuid(idOrSlug)
    ? or(eq(profiles.id, idOrSlug), eq(profiles.slug, idOrSlug))
    : eq(profiles.slug, idOrSlug);
  const where = options.includeHidden ? match : and(match, eq(profiles.hidden, false));

  const [row] = await db
    .select({
      id: profiles.id,
      slug: profiles.slug,
      displayName: profiles.displayName,
      bio: profiles.bio,
      keywords: profiles.keywords,
      location: profiles.location,
      supplementaryInfo: profiles.supplementaryInfo,
      avatarPath: profiles.avatarPath,

      email: authUsers.email,
      currentIntention: profiles.currentIntention,
      intentionUpdatedAt: profiles.intentionUpdatedAt,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .innerJoin(authUsers, eq(authUsers.id, profiles.id))
    .where(where);

  if (!row) return null;
  const [profile] = await attachAvatarUrls([row]);
  return profile;
};

export type MemberSummary = {
  id: string;
  slug: string | null;
  displayName: string;
  location: string | null;
  keywords: string[];
  avatarUrl: string | null;
};

// includeHidden=true returns hidden profiles too — admins only.
export const listMembers = async (options: { includeHidden?: boolean } = {}): Promise<MemberSummary[]> => {
  const where = options.includeHidden
    ? isNotNull(profiles.displayName)
    : and(isNotNull(profiles.displayName), eq(profiles.hidden, false));
  const rows = await db
    .select({
      id: profiles.id,
      slug: profiles.slug,
      displayName: profiles.displayName,
      location: profiles.location,
      keywords: profiles.keywords,
      avatarPath: profiles.avatarPath,
    })
    .from(profiles)
    .where(where)
    .orderBy(asc(profiles.displayName));
  return (await attachAvatarUrls(rows)) as MemberSummary[];
};

export type IntentionSummary = {
  id: string;
  slug: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  currentIntention: string;
  intentionUpdatedAt: Date | null;
};

// Every member who has set a non-empty current intention, freshest
// first — the /intentions browse cloud renders the most recently
// updated on top (highest z-index) and largest. `nulls last` parks the
// rare row whose intentionUpdatedAt was never stamped at the back.
// Hidden profiles are excluded unless an admin caller opts in, matching
// listMembers.
export const listCurrentIntentions = async (options: { includeHidden?: boolean } = {}): Promise<IntentionSummary[]> => {
  const present = and(
    isNotNull(profiles.displayName),
    isNotNull(profiles.currentIntention),
    sql`btrim(${profiles.currentIntention}) <> ''`,
  );
  const where = options.includeHidden ? present : and(present, eq(profiles.hidden, false));
  const rows = await db
    .select({
      id: profiles.id,
      slug: profiles.slug,
      displayName: profiles.displayName,
      avatarPath: profiles.avatarPath,
      currentIntention: profiles.currentIntention,
      intentionUpdatedAt: profiles.intentionUpdatedAt,
    })
    .from(profiles)
    .where(where)
    .orderBy(sql`${profiles.intentionUpdatedAt} desc nulls last`);
  return (await attachAvatarUrls(rows)) as IntentionSummary[];
};

export type HiddenMemberSummary = MemberSummary;

// Hidden-only directory for the admin page. Includes profiles with
// null displayName too, since a profile can be hidden before its owner
// finishes onboarding.
export const listHiddenMembers = async (): Promise<HiddenMemberSummary[]> => {
  const rows = await db
    .select({
      id: profiles.id,
      slug: profiles.slug,
      displayName: profiles.displayName,
      location: profiles.location,
      keywords: profiles.keywords,
      avatarPath: profiles.avatarPath,
    })
    .from(profiles)
    .where(eq(profiles.hidden, true))
    .orderBy(asc(profiles.displayName));
  return (await attachAvatarUrls(rows)) as HiddenMemberSummary[];
};

export type SetProfileHiddenResult = { ok: true } | { error: "not_found" };

export const setProfileHidden = async (params: {
  profileId: string;
  hidden: boolean;
}): Promise<SetProfileHiddenResult> => {
  const result = await db
    .update(profiles)
    .set({ hidden: params.hidden })
    .where(eq(profiles.id, params.profileId))
    .returning({ id: profiles.id });
  if (result.length === 0) return { error: "not_found" };
  return { ok: true };
};

// Placeholder. Same rationale as getProfileForMember — admin tooling
// will choose its own shape when it lands.
export const getProfileForAdmin = async (): Promise<never> => {
  throw new Error("NotImplemented: getProfileForAdmin");
};
