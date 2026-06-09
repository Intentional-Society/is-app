"use client";

import { applyNodeChanges, type Edge, type Node, type NodeChange, type ReactFlowInstance } from "@xyflow/react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation } from "d3-force";
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  computeNormalization,
  edgeAvoidance,
  linkDistance,
  NORMALIZATION_TARGET,
  radialSeed,
} from "./web-graph-layout";
import type { EdgeData, MemberNodeData, SubgraphNode } from "./web-graph-renderers";

// d3-force mutates these objects in place; ReactFlow's Node objects are
// derived from them at each tick. Keeping the two shapes separate makes
// the boundary explicit.
type SimNode = {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
};

type SimEdge = {
  source: string | SimNode;
  target: string | SimNode;
  value: number;
};

// Fraction of the canvas left as breathing room around the graph on every
// fitView. Shared by the initial fit, the per-paint settle fits, and the
// mode-toggle refit so they all frame the web identically — a mismatch would
// re-introduce a zoom shift between them. Exported so the parent's ReactFlow
// fitView prop (initial fit + the Controls fit button) frames it the same way.
export const FIT_VIEW_PADDING = 0.1;

// The filtered subgraph the layout runs over: the nodes and edges that survived
// the depth cull, plus the three node roles the layout used to conflate into one
// "center". WebGraph passes the same id for all three (you); the mini-map will
// split them (root + emphasis = them, nothing pinned).
type SimulationSubgraph = {
  nodes: readonly SubgraphNode[];
  edges: readonly { relatorId: string; relateeId: string; value: number }[];
  // The radial seed's BFS origin — seeded at {0,0} so the layout fans out around
  // it. Always present (the seed needs a root even when nothing is pinned).
  rootId: string;
  // Fixed at the origin via fx/fy and made non-draggable, or null to let the
  // whole cloud float (normalization re-centers it either way).
  pinnedNodeId: string | null;
  // Drawn as the larger avatar (see MemberNode); purely visual.
  emphasizedNodeId: string | null;
};

type FlowInstance = ReactFlowInstance<Node<MemberNodeData>, Edge<EdgeData>>;

type WebGraphSimulation = {
  nodes: Node<MemberNodeData>[];
  onNodesChange: (changes: NodeChange<Node<MemberNodeData>>[]) => void;
  onNodeDragStart: (event: MouseEvent, node: Node<MemberNodeData>) => void;
  onNodeDrag: (event: MouseEvent, node: Node<MemberNodeData>) => void;
  onNodeDragStop: (event: MouseEvent, node: Node<MemberNodeData>) => void;
  // Register the ReactFlow instance (via onInit) so the layout can fit the
  // viewport as it settles.
  registerFlow: (instance: FlowInstance) => void;
  // Flag a user pan/zoom so auto-fitting backs off and leaves their view alone.
  markUserMoved: () => void;
  // Fit the viewport to the current layout at the shared padding — driven from
  // the parent during the view/edit mode height animation.
  fitView: () => void;
};

// Owns the d3-force layout: builds (and rebuilds) the simulation over the
// filtered subgraph, paints normalized render positions into `nodes`, fits the
// viewport as the layout settles, and integrates node dragging. WebGraph hands
// it the filtered subgraph and the ReactFlow instance (via registerFlow) and
// renders the `nodes` it returns; everything stateful about the physics — the
// sim, the normalization, the drag pins — lives here.
export function useWebGraphSimulation(
  filtered: SimulationSubgraph | null,
  fitPadding: number = FIT_VIEW_PADDING,
): WebGraphSimulation {
  const [nodes, setNodes] = useState<Node<MemberNodeData>[]>([]);
  // The fit padding every internal refit uses (settle fits, the "end" fit, and
  // the exposed fitView). Held in a ref so the stable fitView callback and the
  // sim-build effect read the latest without re-subscribing. The mini-map runs
  // roomier than the full graph (fixed-size nodes need margin in a small box).
  const fitPaddingRef = useRef(fitPadding);
  fitPaddingRef.current = fitPadding;
  const simRef = useRef<Simulation<SimNode, SimEdge> | null>(null);
  // Captured via ReactFlow's onInit so we can refit the viewport every
  // time node positions change — fitView only auto-fires on first
  // mount, so a settling simulation would otherwise overflow whatever
  // scale the initial random positions happened to produce.
  const flowRef = useRef<FlowInstance | null>(null);
  // Shared between the d3-force sim and the drag handlers: drag needs
  // to mutate fx/fy on the sim node directly, and drag-induced sim
  // position changes shouldn't re-derive the render-coords scale (the
  // dragged node would drift under your cursor as the bbox shifts).
  const simNodesByIdRef = useRef<Map<string, SimNode>>(new Map());
  const normRef = useRef<{ cx: number; cy: number; scale: number } | null>(null);
  const draggedNodeIdRef = useRef<string | null>(null);
  // True once the user pans/zooms — auto-fitView during sim ticks
  // would otherwise yank the viewport back every ~250ms.
  const userMovedViewportRef = useRef(false);
  // True once the initial layout has fully relaxed (the sim's first "end").
  // Until then paintFromSim refits every paint so the viewport tracks the
  // settling graph at the right scale; after it, only explicit fits run, so a
  // later drag-induced re-warm doesn't yank the viewport around.
  const initialSettleDoneRef = useRef(false);

  // Build (or rebuild) the d3-force simulation whenever the subgraph
  // changes. A pinned node (if any) holds the origin so the layout
  // orients around it; the root seeds the radial fan-out.
  useEffect(() => {
    if (!filtered) return;
    const { rootId, pinnedNodeId, emphasizedNodeId, nodes: subNodes, edges: subEdges } = filtered;

    // Preserve positions across data changes (a new relation, a hops toggle,
    // a depth-filter toggle) so the web doesn't reshuffle. Existing nodes keep
    // their last position; nodes the cull removed simply drop out of the sim;
    // genuinely-new non-center nodes emerge from the center — where a
    // just-related card flies to — and the sim eases them out. Only a true
    // first layout (no prior nodes) gets the radial seed.
    const prevById = simNodesByIdRef.current;
    const isFirstLayout = prevById.size === 0;
    // The first layout gets a deterministic radial seed (you at the origin, the
    // first ring evenly around you, friends-of-friends nestled by their friend),
    // so d3-force polishes a near-correct layout instead of untangling random
    // scatter — same web every load, far fewer crossings. See radialSeed.
    const seed = isFirstLayout
      ? radialSeed(
          subNodes.map((n) => n.id),
          subEdges,
          rootId,
        )
      : null;
    const simNodes: SimNode[] = subNodes.map((n) => {
      // Pin holds the origin and overrides any preserved/seeded position; when
      // nothing is pinned the cloud floats and normalization re-centers it.
      if (n.id === pinnedNodeId) return { id: n.id, x: 0, y: 0, fx: 0, fy: 0 };
      const prev = prevById.get(n.id);
      if (prev) return { id: n.id, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy, fx: null, fy: null };
      const seeded = seed?.get(n.id);
      if (seeded) return { id: n.id, x: seeded.x, y: seeded.y, fx: null, fy: null };
      // A genuinely-new node on an incremental update emerges from the center —
      // where the just-related card flies to — and the sim eases it out.
      return { id: n.id, x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 12, fx: null, fy: null };
    });
    // Lookup map kept around for paintFromSim — avoids an O(n²) .find
    // scan on every tick. Also exposed via simNodesByIdRef so the
    // node-drag handlers (outside this effect) can mutate fx/fy on
    // the dragged node.
    const simNodeById = new Map(simNodes.map((n) => [n.id, n]));
    simNodesByIdRef.current = simNodeById;
    const simEdges: SimEdge[] = subEdges.map((e) => ({
      source: e.relatorId,
      target: e.relateeId,
      value: e.value,
    }));

    // Seed React node positions in render space (the same normalization
    // paintFromSim applies), so preserved nodes start at their rendered spot
    // rather than jumping to raw sim coords for a frame before the first tick.
    const norm = normRef.current;
    const toRender = (x: number, y: number) =>
      norm ? { x: (x - norm.cx) * norm.scale, y: (y - norm.cy) * norm.scale } : { x, y };
    setNodes(
      subNodes.map((n) => {
        const sn = simNodeById.get(n.id);
        return {
          id: n.id,
          type: "member",
          position: toRender(sn?.x ?? 0, sn?.y ?? 0),
          data: { ...n, emphasized: n.id === emphasizedNodeId },
          // The pinned node is fx/fy-held at the origin; letting the user drag it
          // would either fight the pin or move "yourself" on your own web,
          // neither of which is the intent. Unpinned graphs are fully draggable.
          draggable: n.id !== pinnedNodeId,
          // Override ReactFlow's default ".react-flow__node{pointer-events: all}"
          // so only the Avatar (pointer-events-auto + clip-path:circle) is a
          // click target. The corners around the round avatar no longer count
          // as the node, so clicking outside the circle doesn't fire onNodeClick.
          className: "!pointer-events-none",
        };
      }),
    );

    // d3 ticks at ~60fps internally. We push to React state at most once
    // per FRAME_MS so ReactFlow only re-renders ~20 times/sec — physics
    // stays accurate, render budget is 3× cheaper, motion stays visible.
    // Without this throttle a dev build can render-storm so hard the
    // browser never paints between frames and the simulation looks blank.
    const FRAME_MS = 50;
    let lastUpdate = 0;
    // No forceCenter — the viewing member is already pinned at the
    // origin via fx/fy, so forceCenter would only pull the other nodes
    // toward the pinned center, fighting the link-distance equilibrium
    // and causing them to bunch on top of the center.
    //
    // Custom force: push nodes off the segments of edges they don't belong to,
    // so one doesn't settle straight on top of someone else's line (stock
    // forceCollide only knows node-on-node overlap). edgeAvoidance computes the
    // per-edge delta — scaled by alpha (d3's "heat") so it fades as the layout
    // cools — and we accumulate it into the node's velocity.
    const forceAvoidEdges = (alpha: number) => {
      for (const n of simNodes) {
        for (const e of simEdges) {
          const a = e.source as SimNode;
          const b = e.target as SimNode;
          if (n === a || n === b) continue;
          const delta = edgeAvoidance(n.x, n.y, a.x, a.y, b.x, b.y, alpha);
          if (!delta) continue;
          n.vx = (n.vx ?? 0) + delta.dvx;
          n.vy = (n.vy ?? 0) + delta.dvy;
        }
      }
    };

    const sim = forceSimulation(simNodes)
      // Gentle re-warm on an incremental update (existing nodes are already at
      // rest, so they barely move); full heat only for a fresh first layout.
      .alpha(isFirstLayout ? 1 : 0.6)
      // Default alphaMin is 0.001, which combined with the default
      // alphaDecay drags the sim out to ~5s with the last ~3.2s being
      // sub-pixel motion no one can see. Bumping alphaMin cuts the
      // trailing tail off (~1.8s end) without speeding up the
      // perceptible early settling.
      .alphaMin(0.08)
      .force("charge", forceManyBody().strength(-800))
      .force(
        "link",
        forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.id)
          .distance((link) => linkDistance(link.value)),
      )
      .force("collide", forceCollide(60))
      .force("avoid-edges", forceAvoidEdges)
      .on("tick", () => {
        const now = performance.now();
        if (now - lastUpdate < FRAME_MS) return;
        lastUpdate = now;
        paintFromSim();
      })
      .on("end", () => {
        // Final paint while per-paint fitting is still armed, so the last
        // positions are fit before we latch the initial settle closed. After
        // this, paintFromSim stops refitting; the explicit fit below covers a
        // later drag-induced re-warm settling.
        paintFromSim();
        initialSettleDoneRef.current = true;
        // Refit once the layout has fully relaxed, unless the user has already
        // taken over the viewport.
        if (!userMovedViewportRef.current) {
          requestAnimationFrame(() => {
            flowRef.current?.fitView({ padding: fitPaddingRef.current, duration: 200 });
          });
        }
      });

    // Paints React node positions from the live simNodes, normalized so
    // the layout's longer axis spans NORMALIZATION_TARGET sim units and is
    // centered on the origin (see computeNormalization). Combined with a manual
    // fitView refit, this makes the rendered graph fill the viewport regardless
    // of node count.
    function paintFromSim() {
      if (simNodes.length === 0) return;
      // During a drag, freeze the normalization. Recomputing it would
      // shift cx/cy/scale based on the moving bbox, which makes the
      // dragged node visually drift away from the cursor.
      let cx: number;
      let cy: number;
      let scale: number;
      if (draggedNodeIdRef.current && normRef.current) {
        ({ cx, cy, scale } = normRef.current);
      } else {
        const norm = computeNormalization(simNodes, NORMALIZATION_TARGET);
        if (!norm) return;
        ({ cx, cy, scale } = norm);
        normRef.current = norm;
      }

      setNodes((prev) => {
        let changed = false;
        const next = prev.map((node) => {
          const sn = simNodeById.get(node.id);
          if (!sn) return node;
          const x = (sn.x - cx) * scale;
          const y = (sn.y - cy) * scale;
          // Sub-pixel changes don't move anything visually; returning
          // the same array (prev) lets React skip the re-render entirely.
          if (Math.abs(x - node.position.x) < 0.5 && Math.abs(y - node.position.y) < 0.5) {
            return node;
          }
          changed = true;
          return { ...node, position: { x, y } };
        });
        return changed ? next : prev;
      });

      // Refit every paint while the initial layout settles. Normalization pins
      // the longer axis to NORMALIZATION_TARGET, so the fit is stable from the
      // first painted frame — the viewport tracks the settling graph rather
      // than snapping once at the end. A one-shot fit here used to fire (via
      // rAF) before the normalized nodes reached ReactFlow's store, fitting the
      // raw seed instead, which left the graph zoomed-out until the "end" fit
      // visibly zoomed in. Skipped during a drag (we freeze normalization then)
      // and once the user takes over the viewport; stops at initialSettleDone.
      if (!initialSettleDoneRef.current && !userMovedViewportRef.current && !draggedNodeIdRef.current) {
        flowRef.current?.fitView({ padding: fitPaddingRef.current, duration: 0 });
      }
    }

    simRef.current?.stop();
    simRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [filtered]);

  // Required for ReactFlow's drag to actually update positions in our
  // controlled `nodes` state; without it, drag fires events that go
  // nowhere and the node visually doesn't move.
  const onNodesChange = useCallback((changes: NodeChange<Node<MemberNodeData>>[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  // Drag handlers integrate the user with the d3-force sim: pinning
  // the dragged node via fx/fy lets the rest of the graph relax
  // around the new position. On release, fx/fy is cleared so the node
  // re-enters the sim's normal physics.
  const flowPositionToSim = useCallback((flow: { x: number; y: number }) => {
    const norm = normRef.current;
    if (!norm) return null;
    return { x: flow.x / norm.scale + norm.cx, y: flow.y / norm.scale + norm.cy };
  }, []);
  const onNodeDragStart = useCallback(
    (_event: MouseEvent, node: Node<MemberNodeData>) => {
      const simNode = simNodesByIdRef.current.get(node.id);
      const sim = flowPositionToSim(node.position);
      if (!simNode || !sim) return;
      draggedNodeIdRef.current = node.id;
      simNode.fx = sim.x;
      simNode.fy = sim.y;
      // alphaTarget keeps the sim warm for the duration of the drag —
      // without it, alpha decays past alphaMin (~5s on defaults) and
      // ticks stop firing, freezing the layout mid-pull. alpha(0.3)
      // gives an immediate burst, alphaTarget(0.3) keeps it there.
      simRef.current?.alphaTarget(0.3).alpha(0.3).restart();
    },
    [flowPositionToSim],
  );
  const onNodeDrag = useCallback(
    (_event: MouseEvent, node: Node<MemberNodeData>) => {
      const simNode = simNodesByIdRef.current.get(node.id);
      const sim = flowPositionToSim(node.position);
      if (!simNode || !sim) return;
      simNode.fx = sim.x;
      simNode.fy = sim.y;
    },
    [flowPositionToSim],
  );
  const onNodeDragStop = useCallback((_event: MouseEvent, node: Node<MemberNodeData>) => {
    const simNode = simNodesByIdRef.current.get(node.id);
    if (simNode) {
      simNode.fx = null;
      simNode.fy = null;
    }
    // Release the alpha target so the sim cools normally back to rest.
    simRef.current?.alphaTarget(0);
    draggedNodeIdRef.current = null;
  }, []);

  const registerFlow = useCallback((instance: FlowInstance) => {
    flowRef.current = instance;
  }, []);
  const markUserMoved = useCallback(() => {
    userMovedViewportRef.current = true;
  }, []);
  const fitView = useCallback(() => {
    flowRef.current?.fitView({ padding: fitPaddingRef.current, duration: 0 });
  }, []);

  return {
    nodes,
    onNodesChange,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    registerFlow,
    markUserMoved,
    fitView,
  };
}
