import { describe, expect, it } from "vitest";

import {
  CANVAS_MAX_ASPECT,
  CANVAS_MIN_ASPECT,
  computeNeighborNormalization,
  computeNormalization,
  EDGE_AVOID_THRESHOLD,
  EDIT_HEIGHT_FRACTION,
  edgeAvoidance,
  edgeStrokeOpacity,
  edgeStrokeWidth,
  fitAspectClamped,
  linkDistance,
  medianNearestNeighbor,
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

describe("medianNearestNeighbor", () => {
  it("returns 0 for fewer than two points", () => {
    expect(medianNearestNeighbor([])).toBe(0);
    expect(medianNearestNeighbor([{ x: 1, y: 1 }])).toBe(0);
  });

  it("measures each node's distance to its closest other", () => {
    expect(
      medianNearestNeighbor([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe(10);
  });

  it("takes the median across nodes", () => {
    // x = 0, 10, 30 → nearest-neighbor distances 10, 10, 20 → median 10.
    expect(
      medianNearestNeighbor([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 30, y: 0 },
      ]),
    ).toBe(10);
  });
});

describe("computeNeighborNormalization", () => {
  it("returns null for an empty cloud", () => {
    expect(computeNeighborNormalization([], 100)).toBeNull();
  });

  it("scales so the median neighbor gap renders as targetGap, centered on the bbox", () => {
    // Neighbors 20 apart, targetGap 100 → scale 5.
    expect(
      computeNeighborNormalization(
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
        ],
        100,
      ),
    ).toEqual({ cx: 10, cy: 0, scale: 5 });
  });

  it("keeps scale 1 when the spacing is degenerate (coincident points)", () => {
    expect(
      computeNeighborNormalization(
        [
          { x: 3, y: 3 },
          { x: 3, y: 3 },
        ],
        100,
      )?.scale,
    ).toBe(1);
  });

  it("is invariant to overall extent — same neighbor gap, same scale (the point of (b))", () => {
    // A tight pair and a far-flung set with the SAME neighbor gap normalize to the
    // same scale, even though their bounding boxes differ wildly.
    const tight = computeNeighborNormalization(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
      100,
    );
    const spread = computeNeighborNormalization(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 500, y: 0 },
        { x: 520, y: 0 },
      ],
      100,
    );
    expect(spread?.scale).toBe(tight?.scale); // both 5 — the bounding box doesn't matter
  });
});

describe("fitAspectClamped", () => {
  it("returns null for a non-positive rectangle (nothing measured yet)", () => {
    expect(fitAspectClamped(0, 600)).toBeNull();
    expect(fitAspectClamped(600, 0)).toBeNull();
    expect(fitAspectClamped(-10, 600)).toBeNull();
  });

  it("uses an in-range rectangle whole (ratio within [3:4, 4:3])", () => {
    // A square is in range — no letterboxing, the whole box is used.
    expect(fitAspectClamped(600, 600)).toEqual({
      width: 600,
      viewH: 600,
      editH: 600 * EDIT_HEIGHT_FRACTION,
    });
  });

  it("keeps a boundary ratio (exactly 4:3) whole", () => {
    // 800×600 = 4:3 exactly, the widest in-range ratio — used whole, not clamped.
    expect(fitAspectClamped(800, 600)).toEqual({ width: 800, viewH: 600, editH: 600 * EDIT_HEIGHT_FRACTION });
  });

  it("letterboxes a too-wide viewport by narrowing the width to 4:3", () => {
    // 2000×600 (ratio 3.33 > 4:3): fill the height, width clamps to h × 4:3.
    const dims = fitAspectClamped(2000, 600);
    expect(dims).toEqual({ width: 600 * CANVAS_MAX_ASPECT, viewH: 600, editH: 600 * EDIT_HEIGHT_FRACTION });
  });

  it("letterboxes a too-tall viewport by shortening the height to 3:4", () => {
    // 600×2000 (ratio 0.3 < 3:4): fill the width, height clamps to w ÷ 3:4.
    const viewH = 600 / CANVAS_MIN_ASPECT;
    expect(fitAspectClamped(600, 2000)).toEqual({ width: 600, viewH, editH: viewH * EDIT_HEIGHT_FRACTION });
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
