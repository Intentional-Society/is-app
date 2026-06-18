import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  decorateEdges,
  decorateNodes,
  HOVER_EDGE_Z,
  HOVER_NODE_Z,
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

  it("returns edges untouched when nothing is clickable, lit, dimmed, or hovered", () => {
    const edges = [mk("e1"), mk("e2")];
    const out = decorateEdges(edges, {
      litEdgeIds: new Set(),
      dimUnlit: false,
      edgesClickable: false,
      hoverEdgeId: null,
    });
    expect(out[0]).toBe(edges[0]);
    expect(out[1]).toBe(edges[1]);
  });

  it("lights lit edges green and lifts them, dims the rest when dimUnlit", () => {
    const out = decorateEdges([mk("on"), mk("off")], {
      litEdgeIds: new Set(["on"]),
      dimUnlit: true,
      edgesClickable: false,
      hoverEdgeId: null,
    });
    expect(out[0].style?.stroke).toBe("var(--color-success)");
    expect(out[0].zIndex).toBe(SELECTION_EDGE_Z);
    expect(out[1].style?.stroke).toContain("color-mix");
    expect(out[1].zIndex).toBeUndefined();
  });

  it("lights lit edges without dimming the rest when dimUnlit is false (mini-map)", () => {
    const out = decorateEdges([mk("on"), mk("off")], {
      litEdgeIds: new Set(["on"]),
      dimUnlit: false,
      edgesClickable: false,
      hoverEdgeId: null,
    });
    expect(out[0].style?.stroke).toBe("var(--color-success)");
    // The off-path edge is returned untouched — no dim wash.
    expect(out[1].style?.stroke).toBeUndefined();
  });

  it("marks only your own outgoing edge clickable, matching its value bubble", () => {
    const out = decorateEdges([mk("in", false), mk("out", true)], {
      litEdgeIds: new Set(),
      dimUnlit: false,
      edgesClickable: true,
      hoverEdgeId: null,
    });
    // An incoming or 2nd-degree link can't be edited, so its line stays inert —
    // the cursor agrees with the (non-clickable) bubble.
    expect(out[0].className).toBeUndefined();
    expect(out[1].className).toBe("cursor-pointer");
  });

  it("leaves even an outgoing edge unmarked when the canvas's edges aren't clickable (mini-map)", () => {
    const out = decorateEdges([mk("e1", true)], {
      litEdgeIds: new Set(),
      dimUnlit: false,
      edgesClickable: false,
      hoverEdgeId: null,
    });
    expect(out[0].className).toBeUndefined();
  });

  it("lifts a plain hovered edge above the tangle without recoloring it", () => {
    const out = decorateEdges([mk("h"), mk("rest")], {
      litEdgeIds: new Set(),
      dimUnlit: false,
      edgesClickable: false,
      hoverEdgeId: "h",
    });
    expect(out[0].zIndex).toBe(HOVER_EDGE_Z);
    expect(out[0].style?.stroke).toBeUndefined(); // hover reveals, never recolors
    expect(out[1].zIndex).toBeUndefined();
  });

  it("lifts a hovered lit edge above its lit-path z (pointer focus outranks selection)", () => {
    const out = decorateEdges([mk("on")], {
      litEdgeIds: new Set(["on"]),
      dimUnlit: true,
      edgesClickable: false,
      hoverEdgeId: "on",
    });
    // Keeps the lit green stroke but rides the hover tier, not SELECTION_EDGE_Z.
    expect(out[0].style?.stroke).toBe("var(--color-success)");
    expect(out[0].zIndex).toBe(HOVER_EDGE_Z);
  });
});

describe("decorateNodes", () => {
  const mk = (id: string): Node => ({ id, position: { x: 0, y: 0 }, data: {} });

  it("returns the same array reference when nothing is lifted", () => {
    const nodes = [mk("a"), mk("b")];
    expect(decorateNodes(nodes, { litNodeIds: new Set(), hoverNodeIds: new Set() })).toBe(nodes);
  });

  it("lifts lit nodes and leaves the rest untouched", () => {
    const offPath = mk("b");
    const out = decorateNodes([mk("a"), offPath], { litNodeIds: new Set(["a"]), hoverNodeIds: new Set() });
    expect(out[0].zIndex).toBe(SELECTION_NODE_Z);
    expect(out[1]).toBe(offPath);
    expect(out[1].zIndex).toBeUndefined();
  });

  it("lifts hovered nodes to the hover tier above the lit path", () => {
    const out = decorateNodes([mk("h"), mk("lit"), mk("rest")], {
      litNodeIds: new Set(["lit"]),
      hoverNodeIds: new Set(["h"]),
    });
    expect(out[0].zIndex).toBe(HOVER_NODE_Z);
    expect(out[1].zIndex).toBe(SELECTION_NODE_Z);
    expect(out[2].zIndex).toBeUndefined();
  });

  it("gives hover precedence when a node is both lit and hovered", () => {
    const out = decorateNodes([mk("a")], { litNodeIds: new Set(["a"]), hoverNodeIds: new Set(["a"]) });
    expect(out[0].zIndex).toBe(HOVER_NODE_Z);
  });
});
