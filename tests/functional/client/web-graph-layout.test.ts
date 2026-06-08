import { describe, expect, it } from "vitest";

import {
  computeNormalization,
  EDGE_AVOID_THRESHOLD,
  edgeAvoidance,
  edgeStrokeOpacity,
  edgeStrokeWidth,
  linkDistance,
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
