import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";

import { attachAvatarUrls } from "./avatars";
import { db } from "./db";
import { nodeColumns, type SubgraphEdge, type SubgraphNode } from "./relations-personal";
import { profiles, relations } from "./schema";

// The read-only "mini-map" embedded on a member's profile page: the profile
// member, their strong connections, and the viewer's shortest path back to them.
// Distinct from getPersonalWeb (the viewer's own full web) — here the emphasized
// node is *them*, the viewer only appears if a path reaches them, and there's no
// hop/depth toggling.
export type ProfileMiniMap = {
  // The profile member — drawn larger, and the BFS root. Also the layout root.
  emphasizedId: string;
  // The caller. Rendered only if pathToViewer reaches them.
  viewerId: string;
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  // The shortest confirmed-relation path, ordered emphasizedId → … → viewerId
  // (inclusive). Empty when the viewer is unreachable from the profile member.
  pathToViewer: string[];
};

// Builds the mini-map for `profileId` as seen by `viewerId`:
//   1. the shortest undirected path from the profile member back to the viewer,
//   2. the profile member's strongest outgoing connections (4s, then 3s, then
//      2s), added tier-by-tier until the next tier would push past ~maxNodes,
//   3. every confirmed edge among that final node set.
// Hidden/deactivated endpoints are pruned for non-admins exactly as
// getPersonalWeb does; the profile member and the viewer are exempt since they
// anchor the map. At MVP scale (≤100 members, low-hundreds of edges) loading the
// whole confirmed-edge set and doing the BFS + grouping in JS is trivial — swap
// to a bounded expanding-frontier BFS from profileId if the network grows past a
// few thousand edges.
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
    .select({ relatorId: relations.relatorId, relateeId: relations.relateeId, value: relations.value })
    .from(relations)
    .where(isNotNull(relations.value));

  // Which endpoints to drop: deactivated always, hidden only for non-admins.
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

  // Undirected adjacency over visible edges only — a non-admin's path never
  // routes through someone they can't see.
  const adj = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const list = adj.get(from);
    if (list) list.push(to);
    else adj.set(from, [to]);
  };
  for (const e of allRelations) {
    if (!isVisible(e.relatorId) || !isVisible(e.relateeId)) continue;
    link(e.relatorId, e.relateeId);
    link(e.relateeId, e.relatorId);
  }

  // BFS from the profile member; reconstruct the shortest path back to the viewer.
  const parent = new Map<string, string | null>([[profileId, null]]);
  const queue = [profileId];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const nb of adj.get(cur) ?? []) {
      if (!parent.has(nb)) {
        parent.set(nb, cur);
        queue.push(nb);
      }
    }
  }
  const pathToViewer: string[] = [];
  if (parent.has(viewerId)) {
    let cur: string | null | undefined = viewerId;
    while (cur != null) {
      pathToViewer.push(cur);
      cur = parent.get(cur);
    }
    pathToViewer.reverse();
  }

  // The profile member's outgoing confirmed relations, grouped by strength.
  const tierMembers = new Map<number, string[]>();
  for (const e of allRelations) {
    if (e.relatorId !== profileId || !isVisible(e.relateeId)) continue;
    const v = e.value as number;
    const list = tierMembers.get(v);
    if (list) list.push(e.relateeId);
    else tierMembers.set(v, [e.relateeId]);
  }

  // Seed with the path (them, intermediaries, you) — or just them when there's
  // no path — then add strong-connection tiers strongest-first.
  const nodeIds = new Set<string>(pathToViewer.length > 0 ? pathToViewer : [profileId]);
  for (const tier of [4, 3, 2]) {
    const fresh = (tierMembers.get(tier) ?? []).filter((id) => !nodeIds.has(id));
    if (fresh.length === 0) continue;
    // 4s always show, even if they alone exceed the budget. Once a weaker tier
    // would overflow, stop — and so skip every weaker tier with it.
    if (tier !== 4 && nodeIds.size + fresh.length > maxNodes) break;
    for (const id of fresh) nodeIds.add(id);
  }

  // Every confirmed edge among the final node set (both endpoints kept ⇒ both
  // visible), so path edges and strong-connection edges both render.
  const edges: SubgraphEdge[] = allRelations
    .filter((e) => nodeIds.has(e.relatorId) && nodeIds.has(e.relateeId))
    .map((e) => ({ relatorId: e.relatorId, relateeId: e.relateeId, value: e.value as number }));

  const nodeRows = await db
    .select(nodeColumns)
    .from(profiles)
    .where(inArray(profiles.id, [...nodeIds]))
    .orderBy(asc(profiles.displayName));

  return { emphasizedId: profileId, viewerId, nodes: await attachAvatarUrls(nodeRows), edges, pathToViewer };
};
