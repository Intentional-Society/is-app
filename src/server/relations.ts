import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

import { db } from "./db";
import { inviteHints, invites, profiles, relations } from "./schema";

// 1..4 vocabulary lives in design-relations.md. The DB enforces the
// range via relations_value_range and invites_creator_value_range; this
// file's runtime validators repeat the check at the API edge so we can
// return clean 400s before round-tripping to a constraint violation.
export type RelationValue = 1 | 2 | 3 | 4;

export const isRelationValue = (v: unknown): v is RelationValue =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

// Card payload returned in the candidate feed. The fields here are what
// the rating-decision UI needs without navigating away — the design's
// "enough profile information to make a rating decision" requirement.
export type CandidateCard = {
  id: string;
  slug: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  keywords: string[];
  location: string | null;
  reason: CandidateReason;
};

// Soft-hide is enforced here: the "ratedYou" reason carries no value
// field, even though the source row has one. The client cannot leak
// what it never sees.
export type CandidateReason =
  | { type: "ratedYou" }
  | { type: "hint"; hintedBy: { id: string; displayName: string | null; slug: string | null } | null }
  | { type: "viaInviter"; inviter: { id: string; displayName: string | null; slug: string | null } }
  | { type: "recentlyActive" };

export type CandidateFeed = {
  suggestions: CandidateCard[];
  otherMembers: CandidateCard[];
};

const cardColumns = {
  id: profiles.id,
  slug: profiles.slug,
  displayName: profiles.displayName,
  avatarUrl: profiles.avatarUrl,
  bio: profiles.bio,
  keywords: profiles.keywords,
  location: profiles.location,
};

type CardColumns = {
  id: string;
  slug: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  keywords: string[];
  location: string | null;
};

const toCard = (row: CardColumns, reason: CandidateReason): CandidateCard => ({ ...row, reason });

// Candidate feed sources are enumerated in design-relations.md
// "Candidate feed sources." Each person appears at most once, in the
// highest-priority source where they qualify; downstream sources skip
// IDs already collected. At MVP scale the four-query approach is fine —
// none of these touch more than ~hundreds of rows.
export const getCandidates = async (userId: string): Promise<CandidateFeed> => {
  const seen = new Set<string>([userId]);

  // Source 1 — people who rated me (with a value), where I have no row
  // back to them at all (no rating, no hint).
  const ratedMeAlias = relations;
  const ratedMe = await db
    .select(cardColumns)
    .from(ratedMeAlias)
    .innerJoin(profiles, eq(profiles.id, ratedMeAlias.raterId))
    .where(
      and(
        eq(ratedMeAlias.rateeId, userId),
        isNotNull(ratedMeAlias.value),
        sql`NOT EXISTS (SELECT 1 FROM relations rev WHERE rev.rater_id = ${userId} AND rev.ratee_id = ${ratedMeAlias.raterId})`,
      ),
    )
    .orderBy(desc(ratedMeAlias.updatedAt));

  const suggestions: CandidateCard[] = [];
  for (const row of ratedMe) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    suggestions.push(toCard(row, { type: "ratedYou" }));
  }

  // Source 2 — pending hints for me (rater=me, isHint=true, value=null).
  // Two queries: hint rows (with ratee profile), then a batch lookup
  // for hinter profiles. Aliasing profiles twice in one Drizzle query
  // is more code than this at our scale.
  const hintRows = await db
    .select({
      ...cardColumns,
      hintedBy: relations.hintedBy,
      updatedAt: relations.updatedAt,
    })
    .from(relations)
    .innerJoin(profiles, eq(profiles.id, relations.rateeId))
    .where(and(eq(relations.raterId, userId), eq(relations.isHint, true)))
    .orderBy(desc(relations.updatedAt));

  const hintIds = hintRows.map((r) => r.hintedBy).filter((x): x is string => !!x);
  const hinters =
    hintIds.length > 0
      ? await db
          .select({ id: profiles.id, displayName: profiles.displayName, slug: profiles.slug })
          .from(profiles)
          .where(inArray(profiles.id, hintIds))
      : [];
  const hinterById = new Map(hinters.map((h) => [h.id, h]));

  for (const row of hintRows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const hintedBy = row.hintedBy ? hinterById.get(row.hintedBy) ?? null : null;
    const card: CardColumns = {
      id: row.id,
      slug: row.slug,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      bio: row.bio,
      keywords: row.keywords,
      location: row.location,
    };
    suggestions.push(toCard(card, { type: "hint", hintedBy }));
  }

  const otherMembers: CandidateCard[] = [];

  // Source 3 — my inviter's higher-rated connections. Only fires when
  // I have a referredBy and that inviter has confirmed ratings ≥ 3.
  const [me] = await db
    .select({
      referredBy: profiles.referredBy,
      lastUpdatedWeb: profiles.lastUpdatedWeb,
    })
    .from(profiles)
    .where(eq(profiles.id, userId));

  if (me?.referredBy) {
    const inviterId: string = me.referredBy;
    const [inviter] = await db
      .select({ id: profiles.id, displayName: profiles.displayName, slug: profiles.slug })
      .from(profiles)
      .where(eq(profiles.id, inviterId));

    if (inviter) {
      const inviterConnections = await db
        .select(cardColumns)
        .from(relations)
        .innerJoin(profiles, eq(profiles.id, relations.rateeId))
        .where(
          and(
            eq(relations.raterId, inviterId),
            isNotNull(relations.value),
            sql`${relations.value} >= 3`,
            ne(relations.rateeId, userId),
            sql`NOT EXISTS (SELECT 1 FROM relations rev WHERE rev.rater_id = ${userId} AND rev.ratee_id = ${relations.rateeId})`,
          ),
        )
        .orderBy(desc(relations.value), desc(relations.updatedAt));

      for (const row of inviterConnections) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        otherMembers.push(toCard(row, { type: "viaInviter", inviter }));
      }
    }
  }

  // Source 4 — members whose last_updated_web is more recent than mine
  // (or any value, if mine is null). Excludes self and anyone I've
  // already touched.
  const myLastUpdated = me?.lastUpdatedWeb ?? null;
  const recentlyActive = await db
    .select(cardColumns)
    .from(profiles)
    .where(
      and(
        isNotNull(profiles.lastUpdatedWeb),
        ne(profiles.id, userId),
        sql`NOT EXISTS (SELECT 1 FROM relations rev WHERE rev.rater_id = ${userId} AND rev.ratee_id = ${profiles.id})`,
        myLastUpdated
          ? sql`${profiles.lastUpdatedWeb} > ${myLastUpdated.toISOString()}`
          : sql`true`,
      ),
    )
    .orderBy(desc(profiles.lastUpdatedWeb));

  for (const row of recentlyActive) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    otherMembers.push(toCard(row, { type: "recentlyActive" }));
  }

  return { suggestions, otherMembers };
};

// Subgraph payload for the WebGraph component. centerId is whoever the
// graph is rendered around — in the MVP that's always the requesting
// user, but the component is parameterized for the future profile-page
// embed (see design-relations.md "Embedded subgraph displays").
export type SubgraphNode = {
  id: string;
  slug: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

export type SubgraphEdge = {
  raterId: string;
  rateeId: string;
  value: number;
};

export type Subgraph = {
  centerId: string;
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
};

const nodeColumns = {
  id: profiles.id,
  slug: profiles.slug,
  displayName: profiles.displayName,
  avatarUrl: profiles.avatarUrl,
};

// One-hop or two-hop personal subgraph. Hints (value IS NULL) are never
// rendered; they live in the candidate feed.
export const getSubgraph = async (params: {
  centerId: string;
  includeIncoming: boolean;
  includeOutgoing: boolean;
  hops: 1 | 2;
}): Promise<Subgraph> => {
  const { centerId, includeIncoming, includeOutgoing, hops } = params;

  // First hop — direct relations involving centerId.
  const firstHopWhere = (() => {
    if (includeIncoming && includeOutgoing) {
      return or(eq(relations.raterId, centerId), eq(relations.rateeId, centerId));
    }
    if (includeOutgoing) return eq(relations.raterId, centerId);
    if (includeIncoming) return eq(relations.rateeId, centerId);
    return sql`false`;
  })();

  const firstHop = await db
    .select({
      raterId: relations.raterId,
      rateeId: relations.rateeId,
      value: relations.value,
    })
    .from(relations)
    .where(and(firstHopWhere, isNotNull(relations.value)));

  const nodeIds = new Set<string>([centerId]);
  for (const e of firstHop) {
    nodeIds.add(e.raterId);
    nodeIds.add(e.rateeId);
  }

  const edges: SubgraphEdge[] = firstHop.map((e) => ({
    raterId: e.raterId,
    rateeId: e.rateeId,
    // Drizzle's value column is nullable in the type; we filtered on
    // IS NOT NULL above, so the runtime value is guaranteed numeric.
    value: e.value as number,
  }));

  // Second hop — relations among the first-hop neighbors (and to other
  // members they point at). Per design, this surfaces "their relations
  // to each other and to second-degree members" when the toggle is on.
  if (hops === 2) {
    const firstHopIds = [...nodeIds].filter((id) => id !== centerId);
    if (firstHopIds.length > 0) {
      const secondHop = await db
        .select({
          raterId: relations.raterId,
          rateeId: relations.rateeId,
          value: relations.value,
        })
        .from(relations)
        .where(
          and(
            isNotNull(relations.value),
            inArray(relations.raterId, firstHopIds),
            ne(relations.rateeId, centerId),
          ),
        );
      for (const e of secondHop) {
        if (edges.some((existing) => existing.raterId === e.raterId && existing.rateeId === e.rateeId)) {
          continue;
        }
        nodeIds.add(e.rateeId);
        edges.push({ raterId: e.raterId, rateeId: e.rateeId, value: e.value as number });
      }
    }
  }

  const nodeRows =
    nodeIds.size > 0
      ? await db.select(nodeColumns).from(profiles).where(inArray(profiles.id, [...nodeIds])).orderBy(asc(profiles.displayName))
      : [];

  return { centerId, nodes: nodeRows, edges };
};

// rateMember: create or update the (rater, ratee) row with a confirmed
// value. If a pending hint exists, this transition flips isHint to
// false while preserving hintedBy. The check constraint
// relations_hint_state means we have to set both columns in the same
// statement.
export type RateMemberResult = { ok: true } | { error: "self_rating" | "ratee_not_found" };

export const rateMember = async (params: {
  raterId: string;
  rateeId: string;
  value: RelationValue;
}): Promise<RateMemberResult> => {
  if (params.raterId === params.rateeId) return { error: "self_rating" };

  const [exists] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, params.rateeId));
  if (!exists) return { error: "ratee_not_found" };

  await db
    .insert(relations)
    .values({
      raterId: params.raterId,
      rateeId: params.rateeId,
      value: params.value,
      isHint: false,
    })
    .onConflictDoUpdate({
      target: [relations.raterId, relations.rateeId],
      set: {
        value: params.value,
        isHint: false,
        updatedAt: sql`now()`,
      },
    });

  return { ok: true };
};

// createHint: admin-only path. Inserts a pending hint row (value NULL,
// isHint true, hintedBy set). Ignored silently if a row already exists
// — admins shouldn't get a hard error from re-clicking a hint button,
// and the rater's existing state is more authoritative than a re-hint.
export type CreateHintResult =
  | { ok: true; created: boolean }
  | { error: "self_rating" | "rater_not_found" | "ratee_not_found" };

export const createHint = async (params: {
  raterId: string;
  rateeId: string;
  hintedBy: string;
}): Promise<CreateHintResult> => {
  if (params.raterId === params.rateeId) return { error: "self_rating" };

  const found = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(inArray(profiles.id, [params.raterId, params.rateeId]));
  const ids = new Set(found.map((r) => r.id));
  if (!ids.has(params.raterId)) return { error: "rater_not_found" };
  if (!ids.has(params.rateeId)) return { error: "ratee_not_found" };

  const result = await db
    .insert(relations)
    .values({
      raterId: params.raterId,
      rateeId: params.rateeId,
      value: null,
      isHint: true,
      hintedBy: params.hintedBy,
    })
    .onConflictDoNothing({ target: [relations.raterId, relations.rateeId] })
    .returning({ raterId: relations.raterId });

  return { ok: true, created: result.length > 0 };
};

// deleteHint: admin-only withdraw. Only deletes when the row is in the
// pending-hint state — refuses to clobber a confirmed rating, even if
// the admin asked for it.
export type DeleteHintResult = { ok: true } | { error: "not_found" };

export const deleteHint = async (params: {
  raterId: string;
  rateeId: string;
}): Promise<DeleteHintResult> => {
  const result = await db
    .delete(relations)
    .where(
      and(
        eq(relations.raterId, params.raterId),
        eq(relations.rateeId, params.rateeId),
        eq(relations.isHint, true),
      ),
    )
    .returning({ raterId: relations.raterId });

  if (result.length === 0) return { error: "not_found" };
  return { ok: true };
};

// Hint validation for the invite-creation form. Returns either the
// deduplicated UUID list or a structured error code the API surfaces
// as a 400.
export const HINTS_PER_INVITE_LIMIT = 10;

export type ValidateHintsResult =
  | { ok: true; ids: string[] }
  | { error: "invalid"; reason: "not_an_array" | "non_uuid" | "self" | "duplicate" | "too_many" | "not_a_member" };

export const validateInviteHints = async (params: {
  hints: unknown;
  inviterId: string;
}): Promise<ValidateHintsResult> => {
  if (params.hints === undefined || params.hints === null) return { ok: true, ids: [] };
  if (!Array.isArray(params.hints)) return { error: "invalid", reason: "not_an_array" };
  if (params.hints.length === 0) return { ok: true, ids: [] };
  if (params.hints.length > HINTS_PER_INVITE_LIMIT) return { error: "invalid", reason: "too_many" };

  const seen = new Set<string>();
  for (const h of params.hints) {
    if (!isUuid(h)) return { error: "invalid", reason: "non_uuid" };
    if (h === params.inviterId) return { error: "invalid", reason: "self" };
    if (seen.has(h)) return { error: "invalid", reason: "duplicate" };
    seen.add(h);
  }

  const ids = [...seen];
  const found = await db.select({ id: profiles.id }).from(profiles).where(inArray(profiles.id, ids));
  if (found.length !== ids.length) return { error: "invalid", reason: "not_a_member" };

  return { ok: true, ids };
};

// Materialization called from the auth-callback transaction. The
// caller passes the active tx so the relations rows land or roll back
// with the rest of the redemption.
type Tx = PgTransaction<
  // biome-ignore lint/suspicious/noExplicitAny: this is the public
  // postgres-js transaction type, and Drizzle's exposed shape needs
  // the generic surface to compile against `db.transaction(...)`.
  any,
  any,
  any
>;

export const materializeInviteRelations = async (
  tx: Tx | typeof db,
  params: {
    inviteId: string;
    inviterId: string | null;
    redeemerId: string;
    creatorValue: number | null;
  },
): Promise<void> => {
  // creator_value → confirmed inviter→redeemer rating.
  if (params.inviterId && params.creatorValue !== null) {
    await tx
      .insert(relations)
      .values({
        raterId: params.inviterId,
        rateeId: params.redeemerId,
        value: params.creatorValue,
        isHint: false,
      })
      .onConflictDoNothing({ target: [relations.raterId, relations.rateeId] });
  }

  // invite_hints → pending redeemer→ratee hints, hintedBy=inviter.
  const hints = await tx
    .select({ rateeId: inviteHints.rateeId })
    .from(inviteHints)
    .where(eq(inviteHints.inviteId, params.inviteId));

  if (hints.length === 0) return;

  // Defensive filter: skip any hint pointing at the redeemer themselves
  // (would violate relations_no_self). Shouldn't happen via normal
  // flows, but the auth callback shouldn't fail because of upstream
  // data weirdness.
  const rows = hints
    .filter((h) => h.rateeId !== params.redeemerId)
    .map((h) => ({
      raterId: params.redeemerId,
      rateeId: h.rateeId,
      value: null,
      isHint: true,
      hintedBy: params.inviterId,
    }));

  if (rows.length === 0) return;

  await tx
    .insert(relations)
    .values(rows)
    .onConflictDoNothing({ target: [relations.raterId, relations.rateeId] });
};

// Helper for invite creation — writes invite_hints rows in the same
// transaction as the invite itself. Caller has already validated the
// hint list via validateInviteHints.
export const insertInviteHints = async (
  tx: Tx | typeof db,
  params: { inviteId: string; rateeIds: string[] },
): Promise<void> => {
  if (params.rateeIds.length === 0) return;
  await tx.insert(inviteHints).values(params.rateeIds.map((rateeId) => ({ inviteId: params.inviteId, rateeId })));
};

// Convenience wrapper for the API: fetches and parses the admin flag,
// returns 403 sentinel if the caller isn't an admin. Non-admins still
// get to call hint endpoints to discover them — admin-gated routes
// return 403 (not 404) because admin-ness isn't a secret.
export const isAdmin = async (userId: string): Promise<boolean> => {
  const [row] = await db.select({ isAdmin: profiles.isAdmin }).from(profiles).where(eq(profiles.id, userId));
  return row?.isAdmin ?? false;
};

// Re-export check used by API for self-rating short-circuit before
// the DB constraint triggers.
export const sameId = (a: string, b: string): boolean => a === b;
