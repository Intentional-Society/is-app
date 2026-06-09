import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";

import { attachAvatarUrls } from "./avatars";
import { db } from "./db";
import { nodeColumns, type SubgraphEdge, type SubgraphNode } from "./relations-personal";
import { profiles, relations } from "./schema";

// The read-only "mini-map" embedded on a member's profile page: the profile
// member, the viewer, and the most relationally-relevant people connecting or
// surrounding them. Distinct from getPersonalWeb (the viewer's own full web) —
// here the emphasized node is *them*, and the node set is chosen by how it
// relates the viewer and the profile member.
export type ProfileMiniMap = {
  // The profile member — drawn larger, and the layout root.
  emphasizedId: string;
  // The caller — always rendered (counts toward the node budget).
  viewerId: string;
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  // The shortest confirmed-relation path back to the viewer (ties broken by
  // strongest average), ordered emphasizedId → … → viewerId (inclusive). Empty
  // when no path within two hops (and no direct edge) reaches the viewer.
  pathToViewer: string[];
};

// Builds the mini-map for `profileId` as seen by `viewerId`. The node set always
// holds them + you, then fills up to `maxNodes` from three prioritized criteria:
//   1. mutual connections — a single intermediary X with you—X—them both
//      confirmed (either direction), ranked by the average value of that 2-edge
//      path, descending;
//   2. two-hop bridges — a pair X,Y with you—X—Y—them confirmed (X,Y not
//      mutuals), ranked by the 3-edge average, descending; both get added;
//   3. them's closest outgoing relations, by value (4→1) then createdAt (oldest
//      first).
// The lit path is the shortest bridge among those rendered (a direct edge wins,
// then a mutual, then a two-hop), ties broken by the strongest average. Hidden/
// deactivated endpoints are pruned for non-admins; them and you are exempt since
// they anchor the map.
// At MVP scale (≤100 members) loading the whole confirmed-edge set and doing the
// bridge enumeration in JS is trivial; revisit if the network grows large.
export const getProfileMiniMap = async (params: {
  viewerId: string;
  profileId: string;
  includeHidden?: boolean;
  maxNodes?: number;
}): Promise<ProfileMiniMap> => {
  const { viewerId, profileId } = params;
  const includeHidden = params.includeHidden ?? false;
  const maxNodes = params.maxNodes ?? 10;

  const allRelations = await db
    .select({
      relatorId: relations.relatorId,
      relateeId: relations.relateeId,
      value: relations.value,
      createdAt: relations.createdAt,
    })
    .from(relations)
    .where(isNotNull(relations.value));

  // Drop hidden/deactivated endpoints for non-admins (deactivated always); them
  // and you anchor the map, so they're exempt.
  const endpointIds = new Set<string>([viewerId, profileId]);
  for (const e of allRelations) {
    endpointIds.add(e.relatorId);
    endpointIds.add(e.relateeId);
  }
  const dropFilter = includeHidden
    ? isNotNull(profiles.deactivatedAt)
    : or(eq(profiles.hidden, true), isNotNull(profiles.deactivatedAt));
  const droppedIds = new Set<string>();
  const dropRows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(inArray(profiles.id, [...endpointIds]), dropFilter));
  for (const r of dropRows) droppedIds.add(r.id);
  const isVisible = (id: string): boolean => id === profileId || id === viewerId || !droppedIds.has(id);

  const visibleEdges = allRelations.filter((e) => isVisible(e.relatorId) && isVisible(e.relateeId));

  // Undirected view: the confirmed edge values on each unordered pair (1 or 2,
  // for one- or two-directional ties) and each node's neighbor set.
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairValues = new Map<string, number[]>();
  const neighbors = new Map<string, Set<string>>();
  const addNeighbor = (a: string, b: string) => {
    const set = neighbors.get(a);
    if (set) set.add(b);
    else neighbors.set(a, new Set([b]));
  };
  for (const e of visibleEdges) {
    const key = pairKey(e.relatorId, e.relateeId);
    const list = pairValues.get(key);
    if (list) list.push(e.value as number);
    else pairValues.set(key, [e.value as number]);
    addNeighbor(e.relatorId, e.relateeId);
    addNeighbor(e.relateeId, e.relatorId);
  }
  const neighborsOf = (id: string): ReadonlySet<string> => neighbors.get(id) ?? new Set();
  // Average of all confirmed edges along a node sequence (Q3: every edge on the
  // path between the viewer and the profile member).
  const avgPath = (seq: readonly string[]): number => {
    const vals: number[] = [];
    for (let i = 0; i + 1 < seq.length; i++) vals.push(...(pairValues.get(pairKey(seq[i], seq[i + 1])) ?? []));
    return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const viewerNeighbors = neighborsOf(viewerId);
  const profileNeighbors = neighborsOf(profileId);

  // Criterion 1 — single-hop mutuals (you—X—them), strongest average first.
  type Bridge = { path: string[]; avg: number; intermediaries: string[] };
  const mutuals: Bridge[] = [...viewerNeighbors]
    .filter((x) => x !== profileId && profileNeighbors.has(x))
    .map((x) => ({ path: [viewerId, x, profileId], avg: avgPath([viewerId, x, profileId]), intermediaries: [x] }))
    .sort((a, b) => b.avg - a.avg || a.intermediaries[0].localeCompare(b.intermediaries[0]));

  // Criterion 2 — two-hop bridges (you—X—Y—them) where neither intermediary is
  // itself a mutual, strongest average first.
  const twoHops: Bridge[] = [];
  for (const x of viewerNeighbors) {
    if (x === profileId || profileNeighbors.has(x)) continue; // x is them, or a mutual
    for (const y of neighborsOf(x)) {
      if (y === viewerId || y === profileId || y === x) continue;
      if (!profileNeighbors.has(y) || viewerNeighbors.has(y)) continue; // y must bridge to them, and not be a mutual
      const path = [viewerId, x, y, profileId];
      twoHops.push({ path, avg: avgPath(path), intermediaries: [x, y] });
    }
  }
  twoHops.sort((a, b) => b.avg - a.avg || a.intermediaries.join().localeCompare(b.intermediaries.join()));

  // Criterion 3 — them's closest outgoing relations: value 4→1, ties by oldest.
  const closest = visibleEdges
    .filter((e) => e.relatorId === profileId)
    .sort((a, b) => (b.value as number) - (a.value as number) || a.createdAt.getTime() - b.createdAt.getTime());

  // Fill the node set (them + you always in) by priority until the budget caps.
  const nodeIds = new Set<string>([profileId, viewerId]);
  const tryAdd = (id: string) => {
    if (nodeIds.size < maxNodes && id !== profileId && id !== viewerId) nodeIds.add(id);
  };
  for (const b of mutuals) {
    if (nodeIds.size >= maxNodes) break;
    tryAdd(b.intermediaries[0]);
  }
  for (const b of twoHops) {
    if (nodeIds.size >= maxNodes) break;
    for (const id of b.intermediaries) tryAdd(id);
  }
  for (const e of closest) {
    if (nodeIds.size >= maxNodes) break;
    tryAdd(e.relateeId);
  }

  // Lit path: the shortest bridge whose nodes all made it in — a direct you↔them
  // edge wins outright, then a mutual, then a two-hop. Ties within a length are
  // broken by the strongest average, then deterministically.
  const directEdge: Bridge[] = viewerNeighbors.has(profileId)
    ? [{ path: [viewerId, profileId], avg: avgPath([viewerId, profileId]), intermediaries: [] }]
    : [];
  const renderedBridges = [...directEdge, ...mutuals, ...twoHops].filter((b) =>
    b.intermediaries.every((id) => nodeIds.has(id)),
  );
  renderedBridges.sort(
    (a, b) => a.path.length - b.path.length || b.avg - a.avg || a.path.join().localeCompare(b.path.join()),
  );
  // Ordered them → … → you, matching the contract.
  const pathToViewer = renderedBridges.length > 0 ? [...renderedBridges[0].path].reverse() : [];

  // Every confirmed edge among the final node set, so the rendered web shows all
  // interconnections (not just the lit path).
  const edges: SubgraphEdge[] = visibleEdges
    .filter((e) => nodeIds.has(e.relatorId) && nodeIds.has(e.relateeId))
    .map((e) => ({ relatorId: e.relatorId, relateeId: e.relateeId, value: e.value as number }));

  const nodeRows = await db
    .select(nodeColumns)
    .from(profiles)
    .where(inArray(profiles.id, [...nodeIds]))
    .orderBy(asc(profiles.displayName));

  return { emphasizedId: profileId, viewerId, nodes: await attachAvatarUrls(nodeRows), edges, pathToViewer };
};
