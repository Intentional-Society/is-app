// Relation-depth filtering for the WebGraph: cull the fetched subgraph to the
// depths the viewer wants to see. Pure functions over plain data — see
// web-graph-filtering.test.ts. Kept separate from web-graph-selection (which
// derives a highlight from a click) because filtering is its own growing
// concern; further dimensions (incoming edges, hint status, …) will land here.

// Cull the subgraph to the relation depths the viewer wants to see. Edges whose
// value is excluded are dropped; then a BFS from the center over what remains
// keeps only the nodes still connected to the viewer — so hiding the edge that
// linked a friend-of-friend also drops that friend-of-friend instead of leaving
// it floating. The center is always kept, so clearing every depth leaves a lone
// you. Generic so callers pass their concrete node/edge types straight through.
export function filterSubgraphByValue<
  N extends { id: string },
  E extends { relatorId: string; relateeId: string; value: number },
>(
  nodes: readonly N[],
  edges: readonly E[],
  centerId: string,
  includedValues: ReadonlySet<number>,
): { nodes: N[]; edges: E[] } {
  const keptEdges = edges.filter((e) => includedValues.has(e.value));
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };
  for (const e of keptEdges) {
    link(e.relatorId, e.relateeId);
    link(e.relateeId, e.relatorId);
  }
  // Reachable-from-center set over the kept edges; the center seeds it so a fully
  // cleared filter still returns just you.
  const reachable = new Set<string>([centerId]);
  const queue = [centerId];
  for (let i = 0; i < queue.length; i++) {
    for (const nb of adj.get(queue[i]) ?? []) {
      if (!reachable.has(nb)) {
        reachable.add(nb);
        queue.push(nb);
      }
    }
  }
  return {
    nodes: nodes.filter((n) => reachable.has(n.id)),
    edges: keptEdges.filter((e) => reachable.has(e.relatorId) && reachable.has(e.relateeId)),
  };
}
