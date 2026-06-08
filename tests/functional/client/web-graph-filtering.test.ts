import { describe, expect, it } from "vitest";

import { filterSubgraphByValue } from "@/app/myweb/web-graph-filtering";

describe("filterSubgraphByValue", () => {
  const node = (id: string) => ({ id });
  const vedge = (relatorId: string, relateeId: string, value: number) => ({ relatorId, relateeId, value });
  const ids = (ns: { id: string }[]) => ns.map((n) => n.id).sort();
  const edgeIds = (es: { relatorId: string; relateeId: string }[]) => es.map((e) => `${e.relatorId}->${e.relateeId}`);

  // C—A (depth 1), A—B (depth 3): B hangs off the center only through A.
  const nodes = [node("C"), node("A"), node("B")];
  const edges = [vedge("C", "A", 1), vedge("A", "B", 3)];

  it("returns everything when all depths are included", () => {
    const out = filterSubgraphByValue(nodes, edges, "C", new Set([1, 2, 3, 4]));
    expect(ids(out.nodes)).toEqual(["A", "B", "C"]);
    expect(edgeIds(out.edges)).toEqual(["C->A", "A->B"]);
  });

  it("drops edges of an excluded depth but keeps still-connected nodes", () => {
    // Exclude 3 → A—B goes; A stays (linked via C—A), B drops with its edge.
    const out = filterSubgraphByValue(nodes, edges, "C", new Set([1, 2, 4]));
    expect(ids(out.nodes)).toEqual(["A", "C"]);
    expect(edgeIds(out.edges)).toEqual(["C->A"]);
  });

  it("drops a node orphaned when the edge linking it to the center is excluded", () => {
    // Exclude 1 → C—A goes; A is now unreachable, so A, B, and the kept A—B edge
    // all drop. Just the center remains.
    const out = filterSubgraphByValue(nodes, edges, "C", new Set([2, 3, 4]));
    expect(ids(out.nodes)).toEqual(["C"]);
    expect(out.edges).toEqual([]);
  });

  it("leaves a lone center when every depth is excluded", () => {
    const out = filterSubgraphByValue(nodes, edges, "C", new Set());
    expect(ids(out.nodes)).toEqual(["C"]);
    expect(out.edges).toEqual([]);
  });

  it("keeps a node still reachable by an alternate kept path", () => {
    // C—A (1), C—B (1), A—B (4): excluding 4 drops A—B, but A and B stay since
    // both still reach C through depth-1 edges.
    const triangle = [vedge("C", "A", 1), vedge("C", "B", 1), vedge("A", "B", 4)];
    const out = filterSubgraphByValue(nodes, triangle, "C", new Set([1, 2, 3]));
    expect(ids(out.nodes)).toEqual(["A", "B", "C"]);
    expect(edgeIds(out.edges).sort()).toEqual(["C->A", "C->B"]);
  });
});
