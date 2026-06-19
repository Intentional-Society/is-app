import { and, asc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";

import { attachAvatarUrls } from "./avatars";
import { db } from "./db";
import { profiles, relations } from "./schema";

// The viewer's own relationship web, rendered as a subgraph, plus the shared
// node/edge vocabulary that the profile mini-map (relations-mini-map) reuses.

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

// The display columns every subgraph node carries; resolved to a signed avatar
// URL by attachAvatarUrls. Shared with relations-mini-map.
export const nodeColumns = {
  id: profiles.id,
  slug: profiles.slug,
  displayName: profiles.displayName,
  avatarPath: profiles.avatarPath,
};

const edgeKey = (e: { relatorId: string; relateeId: string }): string => `${e.relatorId}:${e.relateeId}`;

// Hints (value IS NULL) are filtered out — they live in the suggestion
// feed, not the rendered web. Hidden profiles are excluded as nodes AND
// edges touching them are dropped, so the rendered web never shows a
// dangling edge to a vanished node; admins see the same web as anyone.
export const getPersonalWeb = async (params: {
  centerId: string;
  includeIncoming: boolean;
  includeOutgoing: boolean;
  hops: 1 | 2;
}): Promise<Subgraph> => {
  const { centerId, includeIncoming, includeOutgoing, hops } = params;

  // First hop — direct relations involving centerId. Pruning an edge whose
  // other end is hidden is done in JS over the endpoint set rather than two
  // subquery joins.
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

  // Determine which ids to drop as nodes and as edge endpoints before
  // rendering: any hidden or deactivated profile.
  const candidateIds = new Set<string>([centerId]);
  for (const e of firstHop) {
    candidateIds.add(e.relatorId);
    candidateIds.add(e.relateeId);
  }
  const dropFilter = or(eq(profiles.hidden, true), isNotNull(profiles.deactivatedAt));
  const hiddenIds = new Set<string>();
  if (candidateIds.size > 0) {
    const rows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(inArray(profiles.id, [...candidateIds]), dropFilter));
    for (const r of rows) hiddenIds.add(r.id);
  }
  // Center is exempt — the viewer's own web always includes themselves,
  // even if they were somehow hidden.
  const isVisible = (id: string): boolean => id === centerId || !hiddenIds.has(id);

  const nodeIds = new Set<string>([centerId]);
  for (const e of firstHop) {
    if (!isVisible(e.relatorId) || !isVisible(e.relateeId)) continue;
    nodeIds.add(e.relatorId);
    nodeIds.add(e.relateeId);
  }

  const edges: SubgraphEdge[] = firstHop
    .filter((e) => isVisible(e.relatorId) && isVisible(e.relateeId))
    .map((e) => ({
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
      // Second-hop relatees can introduce new ids; mark any to-drop ones
      // (hidden or deactivated) so the filter below catches them too.
      const newIds = secondHop.map((e) => e.relateeId).filter((id) => !candidateIds.has(id));
      if (newIds.length > 0) {
        const rows = await db
          .select({ id: profiles.id })
          .from(profiles)
          .where(and(inArray(profiles.id, newIds), dropFilter));
        for (const r of rows) hiddenIds.add(r.id);
        for (const id of newIds) candidateIds.add(id);
      }
      const seen = new Set(edges.map(edgeKey));
      for (const e of secondHop) {
        if (!isVisible(e.relatorId) || !isVisible(e.relateeId)) continue;
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

  return { centerId, nodes: await attachAvatarUrls(nodeRows), edges };
};
