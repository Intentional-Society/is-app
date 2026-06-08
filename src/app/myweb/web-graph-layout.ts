// Pure layout math for the WebGraph: the visual encoding of relation strength,
// the d3-force edge-avoidance kernel, and the bounding-box normalization that
// maps the settled simulation into render space. No React, no d3, no DOM — so
// the tricky geometry is unit-testable in isolation (web-graph-layout.test.ts).

// 1..4 → edge thickness; chosen so a 4-rated friend reads visually distinct
// from a 1-rated acquaintance without dominating the canvas.
export const edgeStrokeWidth = (value: number) => 1.5 + value * 1.25;

// 1..4 → spring rest-length for the d3-force link constraint. Stronger
// relations sit closer (230 → 110 across the range); charge, collide, and
// other-link tensions still resolve the layout, so this biases without ranking
// nodes strictly by edge weight.
export const linkDistance = (value: number) => 270 - value * 40;

// 1..4 → linear ramp from 0.4 to 0.8 over the theme foreground (≈0.4/0.53/
// 0.67/0.8). Reinforces the thickness signal without letting the strongest
// edges read as full-black ink; both themes ride foreground, so each stays
// readable against its own background.
export const edgeStrokeOpacity = (value: number) => 0.4 + ((value - 1) / 3) * 0.4;

// Tuning for the custom edge-avoidance force: a node within THRESHOLD sim units
// of an edge it isn't an endpoint of gets pushed off it, at STRENGTH.
export const EDGE_AVOID_THRESHOLD = 70;
export const EDGE_AVOID_STRENGTH = 0.7;

// The repulsion one node feels from one edge it isn't an endpoint of, for a
// given simulation alpha ("heat"). Distance is measured to the nearest point on
// the *segment* — the projection parameter is clamped to [0,1] — so a node past
// an endpoint is pushed away from that endpoint, not the infinite line. Returns
// null (no push) when the segment is degenerate, the node is beyond THRESHOLD,
// or it sits exactly on the line (no direction, and no divide-by-zero). The
// caller accumulates the returned delta into the node's velocity.
export function edgeAvoidance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  alpha: number,
): { dvx: number; dvy: number } | null {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return null;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const rx = px - (ax + t * dx);
  const ry = py - (ay + t * dy);
  const dist = Math.sqrt(rx * rx + ry * ry);
  if (dist >= EDGE_AVOID_THRESHOLD || dist < 0.001) return null;
  const push = ((EDGE_AVOID_THRESHOLD - dist) / EDGE_AVOID_THRESHOLD) * EDGE_AVOID_STRENGTH * alpha;
  return { dvx: (rx / dist) * push, dvy: (ry / dist) * push };
}

// The longer-axis span (sim units) the settled layout is normalized to fill.
export const NORMALIZATION_TARGET = 600;

// Bounding-box normalization: center the point cloud on the origin and scale
// its longer axis to `target` sim units, so the rendered graph fills the
// viewport regardless of node count. A single point (or a sub-unit spread)
// keeps scale 1 rather than blowing up. Returns null for an empty cloud.
export function computeNormalization(
  points: ReadonlyArray<{ x: number; y: number }>,
  target: number,
): { cx: number; cy: number; scale: number } | null {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let maxX = minX;
  let minY = points[0].y;
  let maxY = minY;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    else if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    else if (p.y > maxY) maxY = p.y;
  }
  const longer = Math.max(maxX - minX, maxY - minY);
  const scale = longer > 1 ? target / longer : 1;
  return { cx: (maxX + minX) / 2, cy: (maxY + minY) / 2, scale };
}
