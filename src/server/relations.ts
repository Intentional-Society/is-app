import {
  and,
  asc,
  desc,
  eq,
  type InferSelectModel,
  inArray,
  isNotNull,
  ne,
  or,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

import { isRelationValue, type RelationValue } from "@/lib/relation-value";

import { isUuid } from "./auth-middleware";
import { db } from "./db";
import { inviteHints, invites, profiles, relations } from "./schema";

// Validates the optional `relationValue` body field shared by POST
// /api/invites and any future route that accepts an optional 1..4.
export type ParsedRelationValue = { ok: true; value: RelationValue | null } | { ok: false; error: string };

export const parseOptionalRelationValue = (raw: unknown): ParsedRelationValue => {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isRelationValue(raw)) return { ok: false, error: "relationValue must be an integer 1..4" };
  return { ok: true, value: raw };
};

// Soft-hide is enforced here: the "addedYou" reason carries no value
// field, even though the source row has one. The client cannot leak
// what it never sees.
export type RelationSuggestionReason =
  | { type: "addedYou" }
  | { type: "hint"; hintedBy: { id: string; displayName: string | null; slug: string | null } | null }
  | { type: "viaInviter"; inviter: { id: string; displayName: string | null; slug: string | null } }
  | { type: "recentlyActive" }
  | { type: "member" };

// Card payload for the rating-decision UI. Fields are chosen so a
// member can decide without navigating away from the suggestion feed.
export type RelationSuggestion = SuggestionCardColumns & { reason: RelationSuggestionReason };

export type RelationSuggestionFeed = {
  suggestions: RelationSuggestion[];
  otherMembers: RelationSuggestion[];
};

// Drizzle select-shape for the card; SuggestionCardColumns is the row type that
// comes back from a select shaped like this. Both names refer to the
// same seven profile fields — kept in sync via Pick<> on the inferred
// row so a future column rename in schema.ts breaks both sites at once.
const cardColumns = {
  id: profiles.id,
  slug: profiles.slug,
  displayName: profiles.displayName,
  avatarUrl: profiles.avatarUrl,
  bio: profiles.bio,
  keywords: profiles.keywords,
  location: profiles.location,
};

type SuggestionCardColumns = Pick<
  InferSelectModel<typeof profiles>,
  "id" | "slug" | "displayName" | "avatarUrl" | "bio" | "keywords" | "location"
>;

const toCard = (row: SuggestionCardColumns, reason: RelationSuggestionReason): RelationSuggestion => ({
  ...row,
  reason,
});

// SQL fragment for "the current user has no row in relations pointing
// at this relatee" — used to exclude already-acted-on people from the
// suggestion sources.
const noRelationFromUserTo = (userId: string, relateeRef: SQLWrapper) =>
  sql`NOT EXISTS (SELECT 1 FROM relations rev WHERE rev.rater_id = ${userId} AND rev.ratee_id = ${relateeRef})`;

const collectInto = <T extends { id: string }>(
  target: RelationSuggestion[],
  seen: Set<string>,
  rows: T[],
  build: (row: T) => RelationSuggestion,
): void => {
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    target.push(build(row));
  }
};

// Sources 1–5 are enumerated in design-relations.md "Suggestion feed
// sources." Each person appears at most once, in the highest-priority
// source where they qualify; downstream sources skip already-collected
// IDs via `seen`. Sources 1–4 land in `suggestions` (signal-bearing);
// source 5 lands in `otherMembers` (catch-all of the rest of the
// directory) so the feed never goes empty while a member remains.
export const getRelationSuggestions = async (userId: string): Promise<RelationSuggestionFeed> => {
  const seen = new Set<string>([userId]);
  const suggestions: RelationSuggestion[] = [];
  const otherMembers: RelationSuggestion[] = [];

  // First wave: every query that doesn't depend on another fires in
  // parallel. Source 1 (addedMe), Source 2 hint rows, the `me` lookup
  // (needed by sources 3 and 4), and Source 5 (everyoneElse) are all
  // independent.
  const [addedMe, hintRows, [me], everyoneElse] = await Promise.all([
    // Source 1 — people who rated me (with a value) and whom I haven't
    // touched back.
    db
      .select(cardColumns)
      .from(relations)
      .innerJoin(profiles, eq(profiles.id, relations.relatorId))
      .where(
        and(
          eq(relations.relateeId, userId),
          isNotNull(relations.value),
          noRelationFromUserTo(userId, relations.relatorId),
        ),
      )
      .orderBy(desc(relations.updatedAt)),
    // Source 2 — pending hints for me. Two queries instead of one
    // self-joined query: aliasing `profiles` twice in Drizzle for the
    // hinter side is more code than this.
    db
      .select({ ...cardColumns, hintedBy: relations.hintedBy })
      .from(relations)
      .innerJoin(profiles, eq(profiles.id, relations.relateeId))
      .where(and(eq(relations.relatorId, userId), eq(relations.isHint, true)))
      .orderBy(desc(relations.updatedAt)),
    db
      .select({ referredBy: profiles.referredBy, lastUpdatedWeb: profiles.lastUpdatedWeb })
      .from(profiles)
      .where(eq(profiles.id, userId)),
    // Source 5 — everybody else. The catch-all that keeps the feed from
    // going empty while there's still anyone in the directory left to
    // relate to. NULLS LAST so a member who's clicked Done at least once
    // outranks a never-engaged one.
    db
      .select(cardColumns)
      .from(profiles)
      .where(and(ne(profiles.id, userId), noRelationFromUserTo(userId, profiles.id)))
      .orderBy(sql`${profiles.lastUpdatedWeb} DESC NULLS LAST`, asc(profiles.displayName)),
  ]);

  // Second wave: hinter lookup depends on hintRows; sources 3 and 4
  // depend on `me`. Still independent of each other, so parallel again.
  const hintIds = hintRows.map((r) => r.hintedBy).filter((x): x is string => !!x);
  const myLastUpdated = me?.lastUpdatedWeb ?? null;
  const inviterId = me?.referredBy ?? null;

  const [hinters, inviter, inviterConnections, recentlyActive] = await Promise.all([
    hintIds.length > 0
      ? db
          .select({ id: profiles.id, displayName: profiles.displayName, slug: profiles.slug })
          .from(profiles)
          .where(inArray(profiles.id, hintIds))
      : Promise.resolve([] as { id: string; displayName: string | null; slug: string | null }[]),
    // Source 3 prep — inviter profile (skipped when there's no inviter).
    inviterId
      ? db
          .select({ id: profiles.id, displayName: profiles.displayName, slug: profiles.slug })
          .from(profiles)
          .where(eq(profiles.id, inviterId))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    // Source 3 — my inviter's higher-rated connections. Fired in
    // parallel with the inviter lookup; if the inviter row is missing
    // (FK guarantees it isn't, but defensively) we just discard these.
    inviterId
      ? db
          .select(cardColumns)
          .from(relations)
          .innerJoin(profiles, eq(profiles.id, relations.relateeId))
          .where(
            and(
              eq(relations.relatorId, inviterId),
              isNotNull(relations.value),
              sql`${relations.value} >= 3`,
              ne(relations.relateeId, userId),
              noRelationFromUserTo(userId, relations.relateeId),
            ),
          )
          .orderBy(desc(relations.value), desc(relations.updatedAt))
      : Promise.resolve([] as SuggestionCardColumns[]),
    // Source 4 — members whose last_updated_web is more recent than
    // mine (or any value, if mine is null).
    db
      .select(cardColumns)
      .from(profiles)
      .where(
        and(
          isNotNull(profiles.lastUpdatedWeb),
          ne(profiles.id, userId),
          noRelationFromUserTo(userId, profiles.id),
          myLastUpdated ? sql`${profiles.lastUpdatedWeb} > ${myLastUpdated.toISOString()}` : sql`true`,
        ),
      )
      .orderBy(desc(profiles.lastUpdatedWeb)),
  ]);

  // Assemble in priority order so the dedupe via `seen` keeps the
  // highest-priority reason for any given person.
  collectInto(suggestions, seen, addedMe, (row) => toCard(row, { type: "addedYou" }));

  const hinterById = new Map(hinters.map((h) => [h.id, h]));
  collectInto(suggestions, seen, hintRows, ({ hintedBy, ...card }) => {
    const hinter = hintedBy ? (hinterById.get(hintedBy) ?? null) : null;
    return toCard(card, { type: "hint", hintedBy: hinter });
  });

  if (inviter) {
    collectInto(suggestions, seen, inviterConnections, (row) => toCard(row, { type: "viaInviter", inviter }));
  }

  collectInto(suggestions, seen, recentlyActive, (row) => toCard(row, { type: "recentlyActive" }));
  collectInto(otherMembers, seen, everyoneElse, (row) => toCard(row, { type: "member" }));

  return { suggestions, otherMembers };
};

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

const edgeKey = (e: { relatorId: string; relateeId: string }): string => `${e.relatorId}:${e.relateeId}`;

// Hints (value IS NULL) are filtered out — they live in the suggestion
// feed, not the rendered web. centerId is parameterized so the same
// component can later embed read-only on member profile pages (see
// design-relations.md "Embedded subgraph displays").
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
    // value is filtered IS NOT NULL in the WHERE, so the runtime cast is safe.
    value: e.value as number,
  }));

  // Second hop — relations among the first-hop neighbors and to other
  // members they point at. Surfaces "their relations to each other and
  // to second-degree members" when hops=2.
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
          and(isNotNull(relations.value), inArray(relations.relatorId, firstHopIds), ne(relations.relateeId, centerId)),
        );
      const seen = new Set(edges.map(edgeKey));
      for (const e of secondHop) {
        const key = edgeKey(e);
        if (seen.has(key)) continue;
        seen.add(key);
        nodeIds.add(e.relateeId);
        edges.push({ relatorId: e.relatorId, relateeId: e.relateeId, value: e.value as number });
      }
    }
  }

  const nodeRows =
    nodeIds.size > 0
      ? await db
          .select(nodeColumns)
          .from(profiles)
          .where(inArray(profiles.id, [...nodeIds]))
          .orderBy(asc(profiles.displayName))
      : [];

  return { centerId, nodes: nodeRows, edges };
};

// Postgres error code 23503 = foreign_key_violation. In
// updateRelationValue the only FK that can fail at insert time is
// relations.ratee_id → profiles.id, so we can safely map any 23503
// to relatee_not_found.
const isForeignKeyViolation = (err: unknown): boolean => {
  if (!err || typeof err !== "object" || !("cause" in err)) return false;
  return (err as { cause?: { code?: string } }).cause?.code === "23503";
};

export type UpdateRelationValueResult = { ok: true } | { error: "self_relating" | "relatee_not_found" };

export const updateRelationValue = async (params: {
  relatorId: string;
  relateeId: string;
  value: RelationValue;
}): Promise<UpdateRelationValueResult> => {
  if (params.relatorId === params.relateeId) return { error: "self_relating" };

  // The `relations_hint_state` check requires value and isHint to move
  // together; a pending hint converting to a confirmed rating must set
  // both in the same statement.
  try {
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
  } catch (err) {
    if (isForeignKeyViolation(err)) return { error: "relatee_not_found" };
    throw err;
  }

  return { ok: true };
};

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

  // Silent no-op on conflict: an admin re-clicking a hint button
  // shouldn't error, and the relator's existing row is more
  // authoritative than a re-hint anyway.
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

export type DeleteRelationHintResult = { ok: true } | { error: "not_found" };

// Refuses to delete a confirmed rating — the isHint = true predicate
// scopes the delete to pending hints only.
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

// Tx | typeof db lets the materializer run inside the auth-callback
// transaction or, in tests, directly against the connection.
type Tx = PgTransaction<
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle's published
  // postgres-js transaction type is genuinely `PgTransaction<any, any, any>`
  // for consumers; the wide generic surface is unavoidable here.
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

  const hints = await tx
    .select({ relateeId: inviteHints.relateeId })
    .from(inviteHints)
    .where(eq(inviteHints.inviteId, params.inviteId));

  if (hints.length === 0) return;

  // Skip any hint pointing at the redeemer themselves — would violate
  // relations_no_self. Shouldn't happen via normal flows, but the auth
  // callback can't fail because of upstream data weirdness.
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

export const insertInviteHints = async (
  tx: Tx | typeof db,
  params: { inviteId: string; relateeIds: string[] },
): Promise<void> => {
  if (params.relateeIds.length === 0) return;
  await tx.insert(inviteHints).values(params.relateeIds.map((relateeId) => ({ inviteId: params.inviteId, relateeId })));
};
