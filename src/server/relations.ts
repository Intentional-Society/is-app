import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

import { isUuid } from "./auth-middleware";
import { db } from "./db";
import { inviteHints, invites, profiles, relations } from "./schema";

// 1..4 vocabulary lives in design-relations.md. The DB enforces the
// range via relations_value_range and invites_creator_value_range; this
// file's runtime validators repeat the check at the API edge so we can
// return clean 400s before round-tripping to a constraint violation.
export type RelationValue = 1 | 2 | 3 | 4;

export const isRelationValue = (v: unknown): v is RelationValue =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4;

// Body-shape parser shared between POST /api/invites (where the
// inviter declares their relation to the invitee) and any other route
// that accepts an optional 1..4 value. Mirrors validateNote's shape:
// happy value or `{error}` envelope.
export const parseOptionalRelationValue = (raw: unknown): RelationValue | null | { error: string } => {
  if (raw === undefined || raw === null) return null;
  if (!isRelationValue(raw)) return { error: "relationValue must be an integer 1..4" };
  return raw;
};

// One suggestion in the relation-suggestion feed. The fields here are
// what the rating-decision UI needs without navigating away — the
// design's "enough profile information to make a rating decision"
// requirement.
export type RelationSuggestion = {
  id: string;
  slug: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  keywords: string[];
  location: string | null;
  reason: RelationSuggestionReason;
};

// Soft-hide is enforced here: the "ratedYou" reason carries no value
// field, even though the source row has one. The client cannot leak
// what it never sees.
export type RelationSuggestionReason =
  | { type: "ratedYou" }
  | { type: "hint"; hintedBy: { id: string; displayName: string | null; slug: string | null } | null }
  | { type: "viaInviter"; inviter: { id: string; displayName: string | null; slug: string | null } }
  | { type: "recentlyActive" };

export type RelationSuggestionFeed = {
  suggestions: RelationSuggestion[];
  otherMembers: RelationSuggestion[];
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

const toCard = (row: CardColumns, reason: RelationSuggestionReason): RelationSuggestion => ({ ...row, reason });

// Candidate feed sources are enumerated in design-relations.md
// "Candidate feed sources." Each person appears at most once, in the
// highest-priority source where they qualify; downstream sources skip
// IDs already collected. At MVP scale the four-query approach is fine —
// none of these touch more than ~hundreds of rows.
export const getRelationSuggestions = async (userId: string): Promise<RelationSuggestionFeed> => {
  const seen = new Set<string>([userId]);

  // Source 1 — people who rated me (with a value), where I have no row
  // back to them at all (no rating, no hint).
  const ratedMe = await db
    .select(cardColumns)
    .from(relations)
    .innerJoin(profiles, eq(profiles.id, relations.relatorId))
    .where(
      and(
        eq(relations.relateeId, userId),
        isNotNull(relations.value),
        sql`NOT EXISTS (SELECT 1 FROM relations rev WHERE rev.rater_id = ${userId} AND rev.ratee_id = ${relations.relatorId})`,
      ),
    )
    .orderBy(desc(relations.updatedAt));

  const suggestions: RelationSuggestion[] = [];
  for (const row of ratedMe) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    suggestions.push(toCard(row, { type: "ratedYou" }));
  }

  // Source 2 — pending hints for me (relator=me, isHint=true, value=null).
  // Two queries: hint rows (with relatee profile), then a batch lookup
  // for hinter profiles. Aliasing profiles twice in one Drizzle query
  // is more code than this at our scale.
  const hintRows = await db
    .select({
      ...cardColumns,
      hintedBy: relations.hintedBy,
      updatedAt: relations.updatedAt,
    })
    .from(relations)
    .innerJoin(profiles, eq(profiles.id, relations.relateeId))
    .where(and(eq(relations.relatorId, userId), eq(relations.isHint, true)))
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

  const otherMembers: RelationSuggestion[] = [];

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
        .innerJoin(profiles, eq(profiles.id, relations.relateeId))
        .where(
          and(
            eq(relations.relatorId, inviterId),
            isNotNull(relations.value),
            sql`${relations.value} >= 3`,
            ne(relations.relateeId, userId),
            sql`NOT EXISTS (SELECT 1 FROM relations rev WHERE rev.rater_id = ${userId} AND rev.ratee_id = ${relations.relateeId})`,
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

// PersonalWeb payload for the WebGraph component. centerId is whoever
// the graph is rendered around — in the MVP that's always the
// requesting user, but the component is parameterized for the future
// profile-page embed (see design-relations.md "Embedded subgraph
// displays").
export type SubgraphNode = {
  id: string;
  slug: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

export type SubgraphEdge = {
  relatorId: string;
  relateeId: string;
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
// rendered; they live in the relation-suggestion feed.
export const getPersonalWeb = async (params: {
  centerId: string;
  includeIncoming: boolean;
  includeOutgoing: boolean;
  hops: 1 | 2;
}): Promise<Subgraph> => {
  const { centerId, includeIncoming, includeOutgoing, hops } = params;

  // First hop — direct relations involving centerId.
  const firstHopWhere = (() => {
    if (includeIncoming && includeOutgoing) {
      return or(eq(relations.relatorId, centerId), eq(relations.relateeId, centerId));
    }
    if (includeOutgoing) return eq(relations.relatorId, centerId);
    if (includeIncoming) return eq(relations.relateeId, centerId);
    return sql`false`;
  })();

  const firstHop = await db
    .select({
      relatorId: relations.relatorId,
      relateeId: relations.relateeId,
      value: relations.value,
    })
    .from(relations)
    .where(and(firstHopWhere, isNotNull(relations.value)));

  const nodeIds = new Set<string>([centerId]);
  for (const e of firstHop) {
    nodeIds.add(e.relatorId);
    nodeIds.add(e.relateeId);
  }

  const edges: SubgraphEdge[] = firstHop.map((e) => ({
    relatorId: e.relatorId,
    relateeId: e.relateeId,
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
          relatorId: relations.relatorId,
          relateeId: relations.relateeId,
          value: relations.value,
        })
        .from(relations)
        .where(
          and(
            isNotNull(relations.value),
            inArray(relations.relatorId, firstHopIds),
            ne(relations.relateeId, centerId),
          ),
        );
      for (const e of secondHop) {
        if (edges.some((existing) => existing.relatorId === e.relatorId && existing.relateeId === e.relateeId)) {
          continue;
        }
        nodeIds.add(e.relateeId);
        edges.push({ relatorId: e.relatorId, relateeId: e.relateeId, value: e.value as number });
      }
    }
  }

  const nodeRows =
    nodeIds.size > 0
      ? await db.select(nodeColumns).from(profiles).where(inArray(profiles.id, [...nodeIds])).orderBy(asc(profiles.displayName))
      : [];

  return { centerId, nodes: nodeRows, edges };
};

// updateRelationValue: create or update the (relator, relatee) row with
// a confirmed value. If a pending hint exists, this transition flips
// isHint to false while preserving hintedBy. The check constraint
// relations_hint_state means we have to set both columns in the same
// statement.
export type UpdateRelationValueResult = { ok: true } | { error: "self_relating" | "relatee_not_found" };

export const updateRelationValue = async (params: {
  relatorId: string;
  relateeId: string;
  value: RelationValue;
}): Promise<UpdateRelationValueResult> => {
  if (params.relatorId === params.relateeId) return { error: "self_relating" };

  const [exists] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, params.relateeId));
  if (!exists) return { error: "relatee_not_found" };

  await db
    .insert(relations)
    .values({
      relatorId: params.relatorId,
      relateeId: params.relateeId,
      value: params.value,
      isHint: false,
    })
    .onConflictDoUpdate({
      target: [relations.relatorId, relations.relateeId],
      set: {
        value: params.value,
        isHint: false,
        updatedAt: sql`now()`,
      },
    });

  return { ok: true };
};

// createRelationHint: admin-only path. Inserts a pending hint row
// (value NULL, isHint true, hintedBy set). Ignored silently if a row
// already exists — admins shouldn't get a hard error from re-clicking
// a hint button, and the relator's existing state is more
// authoritative than a re-hint.
export type CreateRelationHintResult =
  | { ok: true; created: boolean }
  | { error: "self_relating" | "relator_not_found" | "relatee_not_found" };

export const createRelationHint = async (params: {
  relatorId: string;
  relateeId: string;
  hintedBy: string;
}): Promise<CreateRelationHintResult> => {
  if (params.relatorId === params.relateeId) return { error: "self_relating" };

  const found = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(inArray(profiles.id, [params.relatorId, params.relateeId]));
  const ids = new Set(found.map((r) => r.id));
  if (!ids.has(params.relatorId)) return { error: "relator_not_found" };
  if (!ids.has(params.relateeId)) return { error: "relatee_not_found" };

  const result = await db
    .insert(relations)
    .values({
      relatorId: params.relatorId,
      relateeId: params.relateeId,
      value: null,
      isHint: true,
      hintedBy: params.hintedBy,
    })
    .onConflictDoNothing({ target: [relations.relatorId, relations.relateeId] })
    .returning({ relatorId: relations.relatorId });

  return { ok: true, created: result.length > 0 };
};

// deleteRelationHint: admin-only withdraw. Only deletes when the row
// is in the pending-hint state — refuses to clobber a confirmed
// rating, even if the admin asked for it.
export type DeleteRelationHintResult = { ok: true } | { error: "not_found" };

export const deleteRelationHint = async (params: {
  relatorId: string;
  relateeId: string;
}): Promise<DeleteRelationHintResult> => {
  const result = await db
    .delete(relations)
    .where(
      and(
        eq(relations.relatorId, params.relatorId),
        eq(relations.relateeId, params.relateeId),
        eq(relations.isHint, true),
      ),
    )
    .returning({ relatorId: relations.relatorId });

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
    relationValue: number | null;
  },
): Promise<void> => {
  // relation_value → confirmed inviter→redeemer rating.
  if (params.inviterId && params.relationValue !== null) {
    await tx
      .insert(relations)
      .values({
        relatorId: params.inviterId,
        relateeId: params.redeemerId,
        value: params.relationValue,
        isHint: false,
      })
      .onConflictDoNothing({ target: [relations.relatorId, relations.relateeId] });
  }

  // invite_hints → pending redeemer→relatee hints, hintedBy=inviter.
  const hints = await tx
    .select({ relateeId: inviteHints.relateeId })
    .from(inviteHints)
    .where(eq(inviteHints.inviteId, params.inviteId));

  if (hints.length === 0) return;

  // Defensive filter: skip any hint pointing at the redeemer themselves
  // (would violate relations_no_self). Shouldn't happen via normal
  // flows, but the auth callback shouldn't fail because of upstream
  // data weirdness.
  const rows = hints
    .filter((h) => h.relateeId !== params.redeemerId)
    .map((h) => ({
      relatorId: params.redeemerId,
      relateeId: h.relateeId,
      value: null,
      isHint: true,
      hintedBy: params.inviterId,
    }));

  if (rows.length === 0) return;

  await tx
    .insert(relations)
    .values(rows)
    .onConflictDoNothing({ target: [relations.relatorId, relations.relateeId] });
};

// Helper for invite creation — writes invite_hints rows in the same
// transaction as the invite itself. Caller has already validated the
// hint list via validateInviteHints.
export const insertInviteHints = async (
  tx: Tx | typeof db,
  params: { inviteId: string; relateeIds: string[] },
): Promise<void> => {
  if (params.relateeIds.length === 0) return;
  await tx.insert(inviteHints).values(params.relateeIds.map((relateeId) => ({ inviteId: params.inviteId, relateeId })));
};
