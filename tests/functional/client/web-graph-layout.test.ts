import { describe, expect, it } from "vitest";

import {
  computeNormalization,
  EDGE_AVOID_THRESHOLD,
  edgeAvoidance,
  edgeStrokeOpacity,
  edgeStrokeWidth,
  linkDistance,
  radialSeed,
  SEED_FIRST_HOP_RADIUS,
  SEED_RING_GAP,
} from "@/app/myweb/web-graph-layout";

describe("edge visual encoding", () => {
  it("maps relation strength 1..4 to increasing stroke width", () => {
    expect(edgeStrokeWidth(1)).toBe(2.75);
    expect(edgeStrokeWidth(2)).toBe(4);
    expect(edgeStrokeWidth(3)).toBe(5.25);
    expect(edgeStrokeWidth(4)).toBe(6.5);
  });

  it("maps relation strength 1..4 to a 0.4–0.8 opacity ramp", () => {
    expect(edgeStrokeOpacity(1)).toBeCloseTo(0.4);
    expect(edgeStrokeOpacity(2)).toBeCloseTo(0.5333, 3);
    expect(edgeStrokeOpacity(3)).toBeCloseTo(0.6667, 3);
    expect(edgeStrokeOpacity(4)).toBeCloseTo(0.8);
  });

  it("maps stronger relations to shorter spring rest-lengths", () => {
    expect(linkDistance(1)).toBe(230);
    expect(linkDistance(4)).toBe(110);
    // Strictly decreasing — a stronger tie pulls closer.
    expect(linkDistance(1)).toBeGreaterThan(linkDistance(2));
    expect(linkDistance(2)).toBeGreaterThan(linkDistance(3));
    expect(linkDistance(3)).toBeGreaterThan(linkDistance(4));
  });
});

describe("computeNormalization", () => {
  it("returns null for an empty cloud", () => {
    expect(computeNormalization([], 600)).toBeNull();
  });

  it("keeps scale 1 for a single point and centers on it", () => {
    expect(computeNormalization([{ x: 5, y: 5 }], 600)).toEqual({ cx: 5, cy: 5, scale: 1 });
  });

  it("keeps scale 1 when the spread is sub-unit (avoids blow-up)", () => {
    const norm = computeNormalization(
      [
        { x: 0, y: 0 },
        { x: 0.4, y: 0.3 },
      ],
      600,
    );
    expect(norm?.scale).toBe(1);
  });

  it("scales the longer axis to the target and centers the box", () => {
    // x spans 1200, y spans 0 → scale from the x axis.
    expect(
      computeNormalization(
        [
          { x: -600, y: 0 },
          { x: 600, y: 0 },
        ],
        600,
      ),
    ).toEqual({ cx: 0, cy: 0, scale: 0.5 });
  });

  it("uses whichever axis is longer", () => {
    // y spans 300, x spans 100 → scale from the y axis.
    expect(
      computeNormalization(
        [
          { x: 0, y: 0 },
          { x: 100, y: 300 },
        ],
        600,
      ),
    ).toEqual({ cx: 50, cy: 150, scale: 2 });
  });
});

describe("edgeAvoidance", () => {
  // A horizontal segment through the origin, from (-100,0) to (100,0).
  const ax = -100;
  const ay = 0;
  const bx = 100;
  const by = 0;

  it("pushes a nearby node perpendicular to the segment, away from it", () => {
    // 30 above the midpoint: within threshold, pushed straight up.
    const d = edgeAvoidance(0, 30, ax, ay, bx, by, 1);
    expect(d).not.toBeNull();
    expect(d?.dvx).toBeCloseTo(0);
    // push = ((70-30)/70)*0.7*1 ≈ 0.4, all in +y.
    expect(d?.dvy).toBeCloseTo(0.4, 5);
  });

  it("returns null beyond the avoidance threshold", () => {
    expect(edgeAvoidance(0, EDGE_AVOID_THRESHOLD + 1, ax, ay, bx, by, 1)).toBeNull();
  });

  it("measures to the nearer endpoint when the node is past the segment", () => {
    // (150,0) projects past B; without the [0,1] clamp it would land on the
    // infinite line (dist 0 → no push). Clamped, it's measured to the endpoint
    // (dist 50) and pushed in +x, away from it.
    const d = edgeAvoidance(150, 0, ax, ay, bx, by, 1);
    expect(d).not.toBeNull();
    expect(d?.dvx).toBeGreaterThan(0);
    expect(d?.dvy).toBeCloseTo(0);
  });

  it("returns null for a degenerate (zero-length) segment", () => {
    expect(edgeAvoidance(0, 10, 5, 5, 5, 5, 1)).toBeNull();
  });

  it("returns null when the node sits on the segment (no direction, no divide-by-zero)", () => {
    expect(edgeAvoidance(0, 0, ax, ay, bx, by, 1)).toBeNull();
  });

  it("scales the push by the simulation alpha", () => {
    const hot = edgeAvoidance(0, 30, ax, ay, bx, by, 1);
    const cool = edgeAvoidance(0, 30, ax, ay, bx, by, 0.5);
    expect(cool?.dvy).toBeCloseTo((hot?.dvy ?? 0) / 2, 6);
  });
});

describe("radialSeed", () => {
  const edge = (relatorId: string, relateeId: string) => ({ relatorId, relateeId });
  const radius = (p?: { x: number; y: number }) => (p ? Math.hypot(p.x, p.y) : Number.NaN);
  const angleOf = (p?: { x: number; y: number }) => (p ? Math.atan2(p.y, p.x) : Number.NaN);

  it("pins the center at the origin", () => {
    expect(radialSeed(["C"], [], "C").get("C")).toEqual({ x: 0, y: 0 });
  });

  it("places a first-hop node on the first ring", () => {
    const seed = radialSeed(["C", "A"], [edge("C", "A")], "C");
    expect(radius(seed.get("A"))).toBeCloseTo(SEED_FIRST_HOP_RADIUS, 6);
  });

  it("spaces the first ring evenly around the center", () => {
    // Four direct connections → quarters of the circle, id-ordered a,b,c,d.
    const seed = radialSeed(
      ["C", "a", "b", "c", "d"],
      ["a", "b", "c", "d"].map((id) => edge("C", id)),
      "C",
    );
    for (const id of ["a", "b", "c", "d"]) {
      expect(radius(seed.get(id))).toBeCloseTo(SEED_FIRST_HOP_RADIUS, 6);
    }
    // a at 0, b at 90°, c at 180°, d at 270°.
    expect(seed.get("a")?.x).toBeCloseTo(SEED_FIRST_HOP_RADIUS, 6);
    expect(seed.get("b")?.y).toBeCloseTo(SEED_FIRST_HOP_RADIUS, 6);
    expect(seed.get("c")?.x).toBeCloseTo(-SEED_FIRST_HOP_RADIUS, 6);
    expect(seed.get("d")?.y).toBeCloseTo(-SEED_FIRST_HOP_RADIUS, 6);
  });

  it("is independent of edge order and edge direction", () => {
    const ids = ["C", "A", "B", "Z"];
    const a = radialSeed(ids, [edge("C", "A"), edge("C", "B"), edge("A", "Z")], "C");
    // Same graph, edges shuffled and some stored relatee→relator.
    const b = radialSeed(ids, [edge("Z", "A"), edge("B", "C"), edge("C", "A")], "C");
    const dump = (m: Map<string, { x: number; y: number }>) => [...m.entries()].sort(([x], [y]) => x.localeCompare(y));
    expect(dump(a)).toEqual(dump(b));
  });

  it("nestles deeper nodes in an arc around the friend they connect through", () => {
    // C—A, C—B (first ring); A—W, A—Z (second ring, both hanging off A at angle 0).
    const seed = radialSeed(
      ["C", "A", "B", "W", "Z"],
      [edge("C", "A"), edge("C", "B"), edge("A", "W"), edge("A", "Z")],
      "C",
    );
    const aAngle = angleOf(seed.get("A"));
    for (const id of ["W", "Z"]) {
      // One hop deeper sits a full ring-gap further out…
      expect(radius(seed.get(id))).toBeCloseTo(SEED_FIRST_HOP_RADIUS + SEED_RING_GAP, 6);
      // …and stays within A's angular wedge (half the gap between A and B is π/2).
      expect(Math.abs(angleOf(seed.get(id)) - aAngle)).toBeLessThan(Math.PI / 2);
    }
    // The two siblings fan to opposite sides of A, so they don't overlap.
    expect(angleOf(seed.get("W"))).not.toBeCloseTo(angleOf(seed.get("Z")), 6);
  });

  it("gives an unreachable node a finite outer-ring spot", () => {
    const seed = radialSeed(["C", "A", "X"], [edge("C", "A")], "C");
    const x = seed.get("X");
    expect(x).toBeDefined();
    expect(Number.isFinite(radius(x))).toBe(true);
    // Beyond the reachable graph's deepest ring.
    expect(radius(x)).toBeGreaterThan(SEED_FIRST_HOP_RADIUS);
  });
});
