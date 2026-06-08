import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  decorateEdges,
  decorateNodes,
  pathToCenter,
  SELECTION_EDGE_Z,
  SELECTION_NODE_Z,
  shortestPathTree,
} from "@/app/myweb/web-graph-selection";

const edge = (relatorId: string, relateeId: string) => ({ relatorId, relateeId });

describe("shortestPathTree", () => {
  it("roots the center at null", () => {
    expect(shortestPathTree([], "C").get("C")).toBeNull();
  });

  it("builds parent pointers along a linear chain", () => {
    // C — A — B
    const tree = shortestPathTree([edge("C", "A"), edge("A", "B")], "C");
    expect(tree.get("A")).toBe("C");
    expect(tree.get("B")).toBe("A");
  });

  it("treats edges as undirected (a relatee can still be the center's child)", () => {
    // Edge stored relatee→relator still links both ways.
    expect(shortestPathTree([edge("A", "C")], "C").get("A")).toBe("C");
  });

  it("omits nodes unreachable from the center", () => {
    const tree = shortestPathTree([edge("C", "A"), edge("X", "Y")], "C");
    expect(tree.has("X")).toBe(false);
    expect(tree.has("Y")).toBe(false);
  });

  it("picks the route BFS reaches first when a node has two paths", () => {
    // C—A, C—B, A—Z, B—Z: Z is reachable via A or B; A is enqueued first.
    const tree = shortestPathTree([edge("C", "A"), edge("C", "B"), edge("A", "Z"), edge("B", "Z")], "C");
    expect(tree.get("Z")).toBe("A");
  });
});

describe("pathToCenter", () => {
  // Parent map for the chain C — A — B (selecting B walks B→A→C).
  const parents = new Map<string, string | null>([
    ["C", null],
    ["A", "C"],
    ["B", "A"],
  ]);

  it("returns empty sets when nothing is selected", () => {
    const { pathNodeIds, pathEdgeIds } = pathToCenter(null, parents);
    expect(pathNodeIds.size).toBe(0);
    expect(pathEdgeIds.size).toBe(0);
  });

  it("walks the selected node back to the center", () => {
    const { pathNodeIds, pathEdgeIds } = pathToCenter("B", parents);
    expect([...pathNodeIds].sort()).toEqual(["A", "B", "C"]);
    // Each hop is stamped both ways so set-membership finds the real direction.
    expect(pathEdgeIds.has("A->B")).toBe(true);
    expect(pathEdgeIds.has("B->A")).toBe(true);
    expect(pathEdgeIds.has("C->A")).toBe(true);
    expect(pathEdgeIds.has("A->C")).toBe(true);
  });

  it("lights only the node itself when the center is selected", () => {
    const { pathNodeIds, pathEdgeIds } = pathToCenter("C", parents);
    expect([...pathNodeIds]).toEqual(["C"]);
    expect(pathEdgeIds.size).toBe(0);
  });

  it("lights only the node itself when it is unreachable", () => {
    const { pathNodeIds, pathEdgeIds } = pathToCenter("ghost", parents);
    expect([...pathNodeIds]).toEqual(["ghost"]);
    expect(pathEdgeIds.size).toBe(0);
  });
});

describe("decorateEdges", () => {
  const mk = (id: string, isOutgoing = true): Edge<{ isOutgoing: boolean }> => ({
    id,
    source: "s",
    target: "t",
    data: { isOutgoing },
  });

  it("returns edges untouched when nothing is selected", () => {
    const edges = [mk("e1"), mk("e2")];
    const out = decorateEdges(edges, { selectedNodeId: null, selectedEdgeId: null, pathEdgeIds: new Set() });
    expect(out[0]).toBe(edges[0]);
    expect(out[1]).toBe(edges[1]);
  });

  it("lights on-path edges green and lifts them, dims the rest", () => {
    const out = decorateEdges([mk("on"), mk("off")], {
      selectedNodeId: "B",
      selectedEdgeId: null,
      pathEdgeIds: new Set(["on"]),
    });
    expect(out[0].style?.stroke).toBe("var(--color-success)");
    expect(out[0].zIndex).toBe(SELECTION_EDGE_Z);
    expect(out[1].style?.stroke).toContain("color-mix");
    expect(out[1].zIndex).toBeUndefined();
  });

  it("marks a selected outgoing edge as clickable", () => {
    const out = decorateEdges([mk("e1", true)], { selectedNodeId: null, selectedEdgeId: "e1", pathEdgeIds: new Set() });
    expect(out[0].className).toBe("cursor-pointer");
  });

  it("leaves a selected incoming edge unclickable", () => {
    const out = decorateEdges([mk("e1", false)], {
      selectedNodeId: null,
      selectedEdgeId: "e1",
      pathEdgeIds: new Set(),
    });
    expect(out[0].className).toBeUndefined();
  });
});

describe("decorateNodes", () => {
  const mk = (id: string): Node => ({ id, position: { x: 0, y: 0 }, data: {} });

  it("returns the same array reference when nothing is selected", () => {
    const nodes = [mk("a"), mk("b")];
    expect(decorateNodes(nodes, { selectedNodeId: null, pathNodeIds: new Set() })).toBe(nodes);
  });

  it("lifts on-path nodes and leaves the rest untouched", () => {
    const offPath = mk("b");
    const out = decorateNodes([mk("a"), offPath], { selectedNodeId: "a", pathNodeIds: new Set(["a"]) });
    expect(out[0].zIndex).toBe(SELECTION_NODE_Z);
    expect(out[1]).toBe(offPath);
    expect(out[1].zIndex).toBeUndefined();
  });
});
