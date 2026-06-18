import type { Edge, Node } from "@xyflow/react";

// Selection-driven derivations for the WebGraph: the shortest-path tree used to
// find a selected node's chain back to the center, and the decorations that
// light that chain while dimming the rest. Pure functions over plain data — see
// web-graph-selection.test.ts.

// A selection dims everything off the lit path by blending toward the canvas,
// never by making content transparent (which would show edge endpoints through
// an avatar). A dimmed element keeps this fraction of its own color. Reads as a
// ~30% dim; the lit path stays at full strength.
export const DIM_KEEP = 0.7;

// Lift the lit path above the dimmed tangle. xyflow z-indexes each edge's <svg>
// and each node's wrapper from 0, so a high zIndex clears the rest; node > edge
// keeps avatars over their lines.
export const SELECTION_EDGE_Z = 1000;
export const SELECTION_NODE_Z = 1001;

// One tier above the selection: the element under the pointer is the user's live
// focus, so a hover rides over even a lit path. The same node > edge gap keeps an
// avatar capping the lines into it — a hovered edge's endpoints lift for their
// names and stay above the hovered line.
export const HOVER_EDGE_Z = 1002;
export const HOVER_NODE_Z = 1003;

// The edge's value pill renders in xyflow's edge-label layer, which sits *before*
// the nodes in the DOM and forms no stacking context of its own — so by default
// an avatar paints over it, and a hover-lifted endpoint (HOVER_NODE_Z) certainly
// does. A z-index on the pill therefore competes directly in the viewport; one
// tier above the hover nodes keeps a revealed number on top of everything.
export const EDGE_LABEL_Z = 1004;

// Breadth-first shortest-path tree from `centerId` over the (undirected) edge
// set. Returns parent pointers (center → null); nodes unreachable from the
// center are absent. Ties break by edge insertion order — the route BFS reaches
// first wins.
export function shortestPathTree(
  edges: ReadonlyArray<{ relatorId: string; relateeId: string }>,
  centerId: string,
): Map<string, string | null> {
  const parent = new Map<string, string | null>();
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };
  for (const e of edges) {
    link(e.relatorId, e.relateeId);
    link(e.relateeId, e.relatorId);
  }
  parent.set(centerId, null);
  const queue = [centerId];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const nb of adj.get(cur) ?? []) {
      if (!parent.has(nb)) {
        parent.set(nb, cur);
        queue.push(nb);
      }
    }
  }
  return parent;
}

// The node ids and edge ids on the selected node's path back to the center,
// walked via the parent pointers. Edge ids are direction-stamped
// (`relator->relatee`) and we don't know which way the real edge runs, so add
// both candidates and let set-membership at the call site pick the one that
// exists. Empty when nothing is selected; just the node itself when it's the
// center or unreachable.
export function pathToCenter(
  selectedNodeId: string | null,
  parentByNode: ReadonlyMap<string, string | null>,
): { pathNodeIds: Set<string>; pathEdgeIds: Set<string> } {
  const pathNodeIds = new Set<string>();
  const pathEdgeIds = new Set<string>();
  if (selectedNodeId === null) return { pathNodeIds, pathEdgeIds };
  let cur: string | null | undefined = selectedNodeId;
  while (cur != null) {
    pathNodeIds.add(cur);
    const par = parentByNode.get(cur);
    if (par == null) break;
    pathEdgeIds.add(`${par}->${cur}`);
    pathEdgeIds.add(`${cur}->${par}`);
    cur = par;
  }
  return { pathNodeIds, pathEdgeIds };
}

type EdgeDecoration = {
  // Edges painted success-green and lifted above the rest. WebGraph passes the
  // clicked node's path back to you; the mini-map passes the server's path.
  litEdgeIds: ReadonlySet<string>;
  // Dim every edge not in litEdgeIds by blending its stroke toward the canvas.
  // WebGraph dims off-path on a click; the mini-map leaves the rest at full
  // strength (the lit path is co-equal content, not a spotlight).
  dimUnlit: boolean;
  // Whether a click on an edge does anything in this canvas — true in the full
  // graph (a click selects the edge and reveals its number; an outgoing edge's
  // second click opens the relating dialog), false in the read-only mini-map.
  // Drives cursor:pointer, since every edge is equally clickable.
  edgesClickable: boolean;
  // The edge under the pointer, lifted above the tangle so it's traceable end to
  // end. Null when nothing is hovered / in read-only views.
  hoverEdgeId: string | null;
};

// Edge decorations layered onto the base edges: cursor:pointer on every edge
// when the canvas's edges are clickable; the lit edges painted success-green and
// lifted above the rest; every other edge dimmed by blending its stroke toward
// the canvas when dimUnlit is set. Untouched edges are returned by reference, so
// this stays a cheap diff. Generic so callers keep their concrete edge type.
export function decorateEdges<E extends Edge>(
  edges: readonly E[],
  { litEdgeIds, dimUnlit, edgesClickable, hoverEdgeId }: EdgeDecoration,
): E[] {
  return edges.map((e) => {
    const onPath = litEdgeIds.has(e.id);
    const dim = dimUnlit && !onPath;
    const hovered = e.id === hoverEdgeId;
    if (!edgesClickable && !onPath && !dim && !hovered) return e;
    const next = { ...e } as E;
    if (edgesClickable) {
      // ReactFlow merges className onto the edge's <g>; cursor inherits down to
      // both the visible line and the wider invisible interaction path, so the
      // whole line signals it's clickable.
      next.className = "cursor-pointer";
    }
    if (onPath) {
      next.style = { ...e.style, stroke: "var(--color-success)", strokeOpacity: 1 };
      next.zIndex = SELECTION_EDGE_Z;
    } else if (dim) {
      // Same blend-toward-canvas dim as the nodes; for a stroke this is
      // identical to lowering opacity over the canvas, but opacity-free.
      next.style = {
        ...e.style,
        stroke: `color-mix(in srgb, var(--color-canvas-foreground) ${DIM_KEEP * 100}%, var(--color-canvas))`,
      };
    }
    // The pointer focus outranks the lit path, so apply it last — a hovered
    // line lifts above everything (recolor untouched; hover only reveals).
    if (hovered) next.zIndex = HOVER_EDGE_Z;
    return next;
  });
}

// Lift the lit nodes above the dimmed rest, and the hovered nodes above even
// that — so a highlight never sits under a dimmed node, and a hovered node (with
// its revealed name) clears its neighbors. Hover wins when a node is both.
// Returns the same array reference when nothing is lifted, so the caller's memo
// stays stable. Generic so callers keep their concrete node type.
export function decorateNodes<N extends Node>(
  nodes: N[],
  { litNodeIds, hoverNodeIds }: { litNodeIds: ReadonlySet<string>; hoverNodeIds: ReadonlySet<string> },
): N[] {
  if (litNodeIds.size === 0 && hoverNodeIds.size === 0) return nodes;
  return nodes.map((n) => {
    if (hoverNodeIds.has(n.id)) return { ...n, zIndex: HOVER_NODE_Z } as N;
    if (litNodeIds.has(n.id)) return { ...n, zIndex: SELECTION_NODE_Z } as N;
    return n;
  });
}
