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

// The settled point cloud mapped into render space: a center (cx, cy) to
// translate to the origin and a uniform scale. Null means there's nothing to
// frame (empty cloud).
export type Normalization = { cx: number; cy: number; scale: number };
// A strategy for turning settled sim points into a Normalization. The full graph
// scales by local spacing (computeNeighborNormalization); the mini-map by the
// bounding box (computeNormalization). The simulation hook just calls whichever
// it's handed, so the two views differ only in this function.
export type Normalize = (points: ReadonlyArray<{ x: number; y: number }>) => Normalization | null;

// Axis-aligned bounds of the cloud — shared by both normalizers (each frames on
// the bbox center).
function bounds(points: ReadonlyArray<{ x: number; y: number }>) {
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
  return { minX, maxX, minY, maxY };
}

// Bounding-box normalization: center the cloud and scale its longer axis to
// `target` sim units, so the rendered graph fills the viewport regardless of node
// count. A single point (or sub-unit spread) keeps scale 1 rather than blowing
// up. Null for an empty cloud. Used by the read-only mini-map; the full graph
// uses computeNeighborNormalization instead.
export function computeNormalization(
  points: ReadonlyArray<{ x: number; y: number }>,
  target: number,
): Normalization | null {
  if (points.length === 0) return null;
  const { minX, maxX, minY, maxY } = bounds(points);
  const longer = Math.max(maxX - minX, maxY - minY);
  const scale = longer > 1 ? target / longer : 1;
  return { cx: (maxX + minX) / 2, cy: (maxY + minY) / 2, scale };
}

// The median distance from each node to its nearest neighbor (sim units): a
// topology-aware read of how tight the settled layout actually is, which the
// bounding box misses (it sees only the extent, not the internal spacing). O(n²),
// but it runs only on the throttled settle ticks and at rest, over a personal
// web's tens-to-low-hundreds of nodes. Returns 0 for fewer than two points (the
// caller falls back to scale 1).
export function medianNearestNeighbor(points: ReadonlyArray<{ x: number; y: number }>): number {
  if (points.length < 2) return 0;
  const nearest: number[] = [];
  for (let i = 0; i < points.length; i++) {
    let best = Number.POSITIVE_INFINITY;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    nearest.push(Math.sqrt(best));
  }
  nearest.sort((a, b) => a - b);
  const mid = Math.floor(nearest.length / 2);
  return nearest.length % 2 === 1 ? nearest[mid] : (nearest[mid - 1] + nearest[mid]) / 2;
}

// The rendered center-to-center neighbor gap (render units) the layout fills to
// at spacing 1. A regular avatar is h-12 = 3rem = 54px at the app's 112.5% root,
// so this is ~2× an avatar of spacing. The user's spacing multiplier rides on
// top; this is the knob for the default feel.
export const NEIGHBOR_GAP_BASE = 110;

// Neighbor-spacing normalization: center the cloud and scale so its *median
// nearest-neighbor* distance renders as `targetGap` units. Because the avatars
// are a fixed size, fixing the neighbor gap fixes the perceived density —
// invariant to node count, link strength, and clustering, none of which the
// bounding box captures. A degenerate spread keeps scale 1. Null for an empty
// cloud. This is what the full graph feeds the simulation.
export function computeNeighborNormalization(
  points: ReadonlyArray<{ x: number; y: number }>,
  targetGap: number,
): Normalization | null {
  if (points.length === 0) return null;
  const { minX, maxX, minY, maxY } = bounds(points);
  const nn = medianNearestNeighbor(points);
  const scale = nn > 1 ? targetGap / nn : 1;
  return { cx: (maxX + minX) / 2, cy: (maxY + minY) / 2, scale };
}

// View-mode canvas sizing. The box fills the available rectangle but clamps its
// aspect ratio to [3:4, 4:3]: a roughly square area is used whole, and only a
// viewport more extreme than 4:3 (wide desktop) or 3:4 (portrait phone) gets
// letterboxed — in its long direction, so the canvas still fills the short one
// and never overflows. Width is shared by both modes (the toggle only animates
// height), so it's returned once here.
export const CANVAS_MAX_ASPECT = 4 / 3; // widest allowed (width:height) — 4:3 landscape
export const CANVAS_MIN_ASPECT = 3 / 4; // tallest allowed (width:height) — 3:4 portrait
// Edit mode's strip is this fraction of the view-mode height, so it scales with
// the viewport (a taller window gets a taller strip) instead of a fixed px. The
// remaining ~40% leaves room for the suggestion feed below.
export const EDIT_HEIGHT_FRACTION = 0.6;

export type CanvasDims = { width: number; viewH: number; editH: number };

// The largest aspect-clamped box (see above) that fits a `w`×`h` rectangle,
// plus the shorter edit-mode height. Null for a non-positive rectangle (nothing
// measured yet).
export function fitAspectClamped(w: number, h: number): CanvasDims | null {
  if (w <= 0 || h <= 0) return null;
  const ratio = w / h;
  let width: number;
  let viewH: number;
  if (ratio > CANVAS_MAX_ASPECT) {
    // Wider than 4:3 — fill the height, narrow the width to 4:3.
    viewH = h;
    width = h * CANVAS_MAX_ASPECT;
  } else if (ratio < CANVAS_MIN_ASPECT) {
    // Taller than 3:4 — fill the width, shorten the height to 3:4.
    width = w;
    viewH = w / CANVAS_MIN_ASPECT;
  } else {
    // In range — fill the whole rectangle.
    width = w;
    viewH = h;
  }
  return { width, viewH, editH: viewH * EDIT_HEIGHT_FRACTION };
}

// First-hop ring radius (sim units) and the gap added per additional hop. The
// first ring sits near linkDistance's range (110..230) so the force layout
// barely has to move it; normalization rescales the whole cloud to the viewport
// afterward, so only the *relative* spacing here matters.
export const SEED_FIRST_HOP_RADIUS = 220;
export const SEED_RING_GAP = 200;

// Deterministic radial seed for the force layout. A breadth-first walk from the
// center assigns each node a hop depth and the parent it connects through; the
// first ring is spaced evenly around you, and each deeper node is nestled into a
// shrinking arc around its parent — so friends-of-friends cluster by the friend
// they share rather than scattering. d3-force then only polishes a roughly-right
// layout instead of untangling random noise, which kills edge crossings and
// (because no Math.random feeds the first layout) renders the same web on every
// load.
//
// Every level is ordered by id, so the result is independent of edge order. The
// center lands at the origin. Nodes unreachable from the center (no edge path to
// it) are spread on an outer ring, so they still get a finite, deterministic
// spot rather than an undefined position.
export function radialSeed(
  nodeIds: ReadonlyArray<string>,
  edges: ReadonlyArray<{ relatorId: string; relateeId: string }>,
  centerId: string,
  options?: { firstHopRadius?: number; ringGap?: number },
): Map<string, { x: number; y: number }> {
  const firstHopRadius = options?.firstHopRadius ?? SEED_FIRST_HOP_RADIUS;
  const ringGap = options?.ringGap ?? SEED_RING_GAP;

  // Undirected adjacency.
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

  // BFS from the center → depth, parent, and each parent's children. Neighbors
  // are visited in id order so the tree (and thus the angles) don't depend on
  // edge order.
  const depth = new Map<string, number>([[centerId, 0]]);
  const childrenOf = new Map<string, string[]>();
  const queue = [centerId];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const neighbors = (adj.get(cur) ?? []).slice().sort();
    for (const nb of neighbors) {
      if (depth.has(nb)) continue;
      depth.set(nb, (depth.get(cur) ?? 0) + 1);
      const kids = childrenOf.get(cur);
      if (kids) kids.push(nb);
      else childrenOf.set(cur, [nb]);
      queue.push(nb);
    }
  }

  // Angle + the angular wedge each node owns for its own children. The center
  // spreads its children evenly over the full circle; every deeper parent fans
  // its children within a shrunk arc centered on its own angle, so each subtree
  // stays clustered.
  const angle = new Map<string, number>([[centerId, 0]]);
  const wedge = new Map<string, number>([[centerId, Math.PI * 2]]);
  const rootKids = childrenOf.get(centerId) ?? [];
  rootKids.forEach((id, j) => {
    angle.set(id, (j * Math.PI * 2) / rootKids.length);
    wedge.set(id, (Math.PI * 2) / rootKids.length);
  });
  // queue is in BFS order, so a parent's angle/wedge is always set before its
  // children are reached. Depth 0 (center) and depth 1 (handled above) are
  // skipped; this fans depth ≥ 2.
  for (const cur of queue) {
    if ((depth.get(cur) ?? 0) < 1) continue;
    const kids = childrenOf.get(cur);
    if (!kids?.length) continue;
    const parentAngle = angle.get(cur) ?? 0;
    const arc = (wedge.get(cur) ?? Math.PI / 2) * 0.6;
    kids.forEach((id, j) => {
      const offset = kids.length === 1 ? 0 : (j / (kids.length - 1) - 0.5) * arc;
      angle.set(id, parentAngle + offset);
      wedge.set(id, arc / kids.length);
    });
  }

  const pos = new Map<string, { x: number; y: number }>([[centerId, { x: 0, y: 0 }]]);
  let maxDepth = 0;
  for (const [id, d] of depth) {
    if (id === centerId) continue;
    if (d > maxDepth) maxDepth = d;
    const r = firstHopRadius + (d - 1) * ringGap;
    const a = angle.get(id) ?? 0;
    pos.set(id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
  }

  // Anything the BFS never reached (an isolated node with no edges) lands on a
  // ring just outside the deepest hop, id-ordered so it stays deterministic.
  const unreached = nodeIds.filter((id) => !depth.has(id)).sort();
  const outerR = firstHopRadius + maxDepth * ringGap;
  unreached.forEach((id, j) => {
    const a = (j * Math.PI * 2) / unreached.length;
    pos.set(id, { x: Math.cos(a) * outerR, y: Math.sin(a) * outerR });
  });

  return pos;
}
