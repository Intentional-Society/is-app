"use client";

import "@xyflow/react/dist/style.css";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  applyNodeChanges,
  BaseEdge,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getStraightPath,
  Handle,
  type Node,
  type NodeChange,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation } from "d3-force";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { RelationSubgraph } from "@/lib/api-types";
import { isRelationValue } from "@/lib/relation-value";

import { DEFAULT_SUBGRAPH_VIEW, RELATION_SUBGRAPH_QUERY_KEY, type SubgraphViewOptions } from "./query-keys";
import type { RelatingTarget } from "./relating-dialog";

type SubgraphNode = RelationSubgraph["nodes"][number];

type MemberNodeData = SubgraphNode & {
  isCenter: boolean;
};

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

type EdgeData = {
  isOutgoing: boolean;
  value: number;
  relateeId: string;
  relateeName: string | null;
};

const fetchSubgraph = async (opts: SubgraphViewOptions) => {
  const res = await apiClient.api.relations.subgraph.$get({
    query: {
      hops: String(opts.hops),
    },
  });
  if (!res.ok) throw new Error(`relations/subgraph: ${res.status}`);
  return res.json();
};

// 1..4 → edge thickness; chosen so a 4-rated friend reads visually
// distinct from a 1-rated acquaintance without dominating the canvas.
const edgeStrokeWidth = (value: number) => 1.5 + value * 1.25;

// 1..4 → spring rest-length for the d3-force link constraint. Stronger
// relations want to sit closer (230 → 110 across the range). Charge,
// collide, and other-link tensions still resolve the layout, so this
// biases without ranking nodes strictly by edge weight.
const linkDistance = (value: number) => 270 - value * 40;

// 1..4 → linear ramp from 0.4 to 0.8 over the theme foreground (so
// ≈0.4/0.53/0.67/0.8). Reinforces the thickness signal without letting
// the strongest edges read as full-black ink. Both light and dark
// themes ride foreground, so each stays readable against its own
// background.
const edgeStrokeOpacity = (value: number) => 0.4 + ((value - 1) / 3) * 0.4;

// Handles are required for ReactFlow to anchor edges; rendering both at
// the same vertically-centered position with opacity 0 makes edges read
// as center-to-center lines without showing connector dots.
const HANDLE_STYLE = { opacity: 0, top: "50%", pointerEvents: "none" as const };

function MemberNode({ data }: NodeProps<Node<MemberNodeData>>) {
  return (
    // pointer-events-none on the wrapper + the !pointer-events-none
    // override on .react-flow__node (set per-node above) means only the
    // Avatar (pointer-events-auto + clip-path:circle) is a click
    // target. The name renders in flow below the avatar so the wrapper
    // bounding box covers the full visible node, but its
    // pointer-events-none keeps clicks on the name inert.
    <div className="pointer-events-none flex flex-col items-center gap-1">
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Top} style={HANDLE_STYLE} />
      <Avatar
        name={data.displayName}
        url={data.avatarUrl}
        className={`pointer-events-auto flex cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 [clip-path:circle()] transition-transform duration-150 hover:scale-110 ${
          data.isCenter ? "h-16 w-16 border-primary" : "h-12 w-12 border-border"
        } bg-muted text-base font-semibold text-muted-foreground`}
      />
      <div className="pointer-events-none max-w-[8rem] truncate text-sm font-medium">{data.displayName ?? "—"}</div>
    </div>
  );
}

const nodeTypes = { member: MemberNode };

// Carries edge-number reveal state + the relating callback to the
// NumberedEdge instances without threading them through the edge data object
// (which would defeat the edges useMemo). The Provider wraps ReactFlow so
// context still reaches the edges registered via the edgeTypes prop.
type EdgeInteraction = {
  openRelating: (target: RelatingTarget) => void;
  // Transient hover preview (desktop) and the selected edge (click/tap). A
  // number shows when its id matches either.
  hoverEdgeId: string | null;
  selectedEdgeId: string | null;
  previewEdge: (id: string) => void;
  endPreviewSoon: () => void;
};
const EdgeInteractionContext = createContext<EdgeInteraction | null>(null);

// Straight-line edge with an HTML circle label at the geometric midpoint
// of the line between source and target. ReactFlow's default bezier
// edges arc upward (both ends are Position.Top), so their parametric
// midpoint sits above the visual line — using a straight edge keeps the
// label on the line, and HTML labels (via EdgeLabelRenderer) give us a
// real circular pill that an SVG <rect> can't.
//
// The number is hidden until its edge is active (hovered, or tapped within
// the edge's interactionWidth). While hidden it's pointer-events-none so the
// hover/tap falls through to the line; while shown it captures clicks to open
// the relating dialog. onMouseEnter/Leave bridge the pointer's trip from the
// line onto the number (paired with the parent's short hide delay).

function NumberedEdge({ id, sourceX, sourceY, targetX, targetY, style, data }: EdgeProps<Edge<EdgeData>>) {
  const [edgePath, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const interaction = useContext(EdgeInteractionContext);
  const isClickable = data?.isOutgoing === true && interaction !== null;
  const isVisible = interaction !== null && (interaction.hoverEdgeId === id || interaction.selectedEdgeId === id);
  const handleClick = isClickable
    ? () =>
        interaction?.openRelating({
          id: data.relateeId,
          displayName: data.relateeName,
          currentValue: isRelationValue(data.value) ? data.value : null,
        })
    : undefined;
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={handleClick}
          onMouseEnter={() => interaction?.previewEdge(id)}
          onMouseLeave={() => interaction?.endPreviewSoon()}
          disabled={!isClickable}
          aria-hidden={!isVisible}
          aria-label={isClickable ? "Adjust this relationship" : undefined}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          className={`flex h-5 w-5 items-center justify-center rounded-full bg-canvas/80 text-xs font-semibold text-canvas-foreground transition-opacity duration-150 ${
            isVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          } ${isClickable ? "cursor-pointer hover:bg-canvas" : "cursor-default"}`}
        >
          {data?.value}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { numbered: NumberedEdge };

const VIEW_STORAGE_KEY = "isweb-graph-view";

// View<->edit canvas animation. View is a square whose height tracks the
// measured width; edit collapses to EDIT_HEIGHT. Width never changes between
// modes, so only the height animates — top-anchored, so the bottom edge
// travels while ReactFlow re-fits each frame to scale the graph with the box.
const EDIT_HEIGHT = 500;
const MODE_ANIM_MS = 1000;
const MODE_ANIM_EASE = "cubic-bezier(0.45, 0, 0.55, 1)"; // accelerate + decelerate

// Permissive parser — any malformed/legacy payload falls back to the
// default. Strict validation matters because the parsed shape feeds the
// useQuery key and would otherwise produce a failing API request on
// every mount.
function parseStoredView(raw: string | null): SubgraphViewOptions | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "hops" in parsed && (parsed.hops === 1 || parsed.hops === 2)) {
      return { hops: parsed.hops };
    }
  } catch {
    // fall through to null
  }
  return null;
}

export function WebGraph({
  square,
  onOpenRelating,
  onReplayTour,
}: {
  // View mode renders a tall, centered square canvas; edit mode keeps the
  // shorter landscape strip so the suggestion feed below stays in view.
  square: boolean;
  onOpenRelating: (target: RelatingTarget) => void;
  onReplayTour: () => void;
}) {
  const router = useRouter();
  const [view, setView] = useState<SubgraphViewOptions>(DEFAULT_SUBGRAPH_VIEW);
  const [hintOpen, setHintOpen] = useState(false);

  // Restore the user's last filter choice across reloads. Done in an
  // effect rather than the useState initializer so SSR-rendered markup
  // matches the hydrated client tree; the prefetched cache covers only
  // the default view, so this triggers a single client refetch when the
  // stored shape differs (placeholderData below suppresses the flash).
  useEffect(() => {
    const stored = parseStoredView(window.localStorage.getItem(VIEW_STORAGE_KEY));
    if (stored && stored.hops !== DEFAULT_SUBGRAPH_VIEW.hops) setView(stored);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
  }, [view]);
  // The view options become part of the query key so toggling refetches
  // automatically and the relating-dialog's mutation invalidator (which uses the
  // bare ["relations", "subgraph"] key) still hits every variant.
  const { data, isPending, isError } = useQuery({
    queryKey: [...RELATION_SUBGRAPH_QUERY_KEY, view] as const,
    queryFn: () => fetchSubgraph(view),
    // The default view is prefetched server-side and dehydrated into
    // this cache; staleTime keeps the client from immediately refetching
    // it on mount. Mutations still invalidate via the relating-dialog
    // onSettled handler, so this only suppresses redundant fetches.
    staleTime: 60_000,
    // Without this, toggling a view checkbox the first time collapses
    // the graph to the loading placeholder while the new key fetches.
    placeholderData: keepPreviousData,
  });

  const [nodes, setNodes] = useState<Node<MemberNodeData>[]>([]);
  const simRef = useRef<Simulation<SimNode, SimEdge> | null>(null);
  // Captured via ReactFlow's onInit so we can refit the viewport every
  // time node positions change — fitView only auto-fires on first
  // mount, so a settling simulation would otherwise overflow whatever
  // scale the initial random positions happened to produce.
  const flowRef = useRef<ReactFlowInstance<Node<MemberNodeData>, Edge<EdgeData>> | null>(null);
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
  // True once paintFromSim has run a one-shot fit against the
  // normalized layout. ReactFlow's `fitView` prop fires too early
  // (before the first paint) and would otherwise leave the viewport
  // sized for the unnormalized random positions.
  const initialPaintFittedRef = useRef(false);

  // Edges never change after the subgraph loads — derive instead of
  // duplicating into React state.
  const edges = useMemo<Edge<EdgeData>[]>(() => {
    if (!data) return [];
    const centerId = data.centerId;
    const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
    return data.edges.map((e) => {
      const isOutgoing = e.relatorId === centerId;
      const relatee = nodeById.get(e.relateeId);
      return {
        id: `${e.relatorId}->${e.relateeId}`,
        source: e.relatorId,
        target: e.relateeId,
        type: "numbered",
        // ±5px invisible hit area around the thin line, so hover (desktop) or
        // a tap within 5px (mobile) reveals the number.
        interactionWidth: 10,
        style: {
          stroke: "var(--color-canvas-foreground)",
          strokeOpacity: edgeStrokeOpacity(e.value),
          strokeWidth: edgeStrokeWidth(e.value),
        },
        data: {
          isOutgoing,
          value: e.value,
          relateeId: e.relateeId,
          relateeName: relatee?.displayName ?? null,
        },
      };
    });
  }, [data]);

  // Build (or rebuild) the d3-force simulation whenever the subgraph
  // changes. The viewing member is pinned at the origin so the layout
  // always orients around them.
  useEffect(() => {
    if (!data) return;
    const centerId = data.centerId;

    // Preserve positions across data changes (a new relation, a hops toggle)
    // so the web doesn't reshuffle. Existing nodes keep their last position;
    // new non-center nodes emerge from the center — where a just-related card
    // flies to — and the sim eases them out. Only a true first layout (no
    // prior nodes) scatters randomly.
    const prevById = simNodesByIdRef.current;
    const isFirstLayout = prevById.size === 0;
    const simNodes: SimNode[] = data.nodes.map((n) => {
      if (n.id === centerId) return { id: n.id, x: 0, y: 0, fx: 0, fy: 0 };
      const prev = prevById.get(n.id);
      if (prev) return { id: n.id, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy, fx: null, fy: null };
      const spread = isFirstLayout ? 200 : 12;
      return { id: n.id, x: (Math.random() - 0.5) * spread, y: (Math.random() - 0.5) * spread, fx: null, fy: null };
    });
    // Lookup map kept around for paintFromSim — avoids an O(n²) .find
    // scan on every tick. Also exposed via simNodesByIdRef so the
    // node-drag handlers (outside this effect) can mutate fx/fy on
    // the dragged node.
    const simNodeById = new Map(simNodes.map((n) => [n.id, n]));
    simNodesByIdRef.current = simNodeById;
    const simEdges: SimEdge[] = data.edges.map((e) => ({
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
      data.nodes.map((n) => {
        const sn = simNodeById.get(n.id);
        return {
          id: n.id,
          type: "member",
          position: toRender(sn?.x ?? 0, sn?.y ?? 0),
          data: { ...n, isCenter: n.id === centerId },
          // Center node is fx/fy-pinned at the origin; letting the user
          // drag it would either fight the pin or move "yourself" on
          // your own web, neither of which is the intent.
          draggable: n.id !== centerId,
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
    // Custom force: gently push nodes off the segments of edges they
    // don't belong to. Stock forceCollide handles node-on-node overlap
    // but doesn't know about edges, so without this a node can settle
    // straight on top of someone else's line. Scaled by alpha (d3's
    // simulation "heat") so it fades as the layout cools.
    const AVOID_THRESHOLD = 70;
    const AVOID_STRENGTH = 0.7;
    const forceAvoidEdges = (alpha: number) => {
      for (const n of simNodes) {
        for (const e of simEdges) {
          const a = e.source as SimNode;
          const b = e.target as SimNode;
          if (n === a || n === b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len2 = dx * dx + dy * dy;
          if (len2 < 1) continue;
          // t = projection of n onto the line through a,b, clamped to
          // [0,1] so the closest point stays on the segment.
          let t = ((n.x - a.x) * dx + (n.y - a.y) * dy) / len2;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const rx = n.x - (a.x + t * dx);
          const ry = n.y - (a.y + t * dy);
          const dist = Math.sqrt(rx * rx + ry * ry);
          if (dist >= AVOID_THRESHOLD || dist < 0.001) continue;
          const push = ((AVOID_THRESHOLD - dist) / AVOID_THRESHOLD) * AVOID_STRENGTH * alpha;
          n.vx = (n.vx ?? 0) + (rx / dist) * push;
          n.vy = (n.vy ?? 0) + (ry / dist) * push;
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
        paintFromSim();
        // One-shot refit once the layout has fully relaxed, unless the
        // user has already taken over the viewport.
        if (!userMovedViewportRef.current) {
          requestAnimationFrame(() => {
            flowRef.current?.fitView({ padding: 0.15, duration: 200 });
          });
        }
      });

    // Paints React node positions from the live simNodes, normalized so
    // the layout's longer axis spans TARGET sim units and is centered
    // on the origin. Combined with a manual fitView refit, this makes
    // the rendered graph fill the viewport regardless of node count.
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
        const TARGET = 600;
        let minX = simNodes[0].x;
        let maxX = minX;
        let minY = simNodes[0].y;
        let maxY = minY;
        for (let i = 1; i < simNodes.length; i++) {
          const sn = simNodes[i];
          if (sn.x < minX) minX = sn.x;
          else if (sn.x > maxX) maxX = sn.x;
          if (sn.y < minY) minY = sn.y;
          else if (sn.y > maxY) maxY = sn.y;
        }
        const longer = Math.max(maxX - minX, maxY - minY);
        scale = longer > 1 ? TARGET / longer : 1;
        cx = (maxX + minX) / 2;
        cy = (maxY + minY) / 2;
        normRef.current = { cx, cy, scale };
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

      // One-shot fit on the first normalized paint — ReactFlow's
      // `fitView` prop fires before this runs, against the unnormalized
      // 200-unit random layout, so without this the viewport stays
      // zoomed in for the entire settling phase. After this initial
      // fit, no periodic refits during settling (the normalization
      // keeps the layout at a stable ~TARGET sim units). The sim's
      // "end" handler does one more fit when the layout has fully
      // relaxed.
      if (!initialPaintFittedRef.current && !userMovedViewportRef.current) {
        initialPaintFittedRef.current = true;
        requestAnimationFrame(() => {
          flowRef.current?.fitView({ padding: 0.15, duration: 0 });
        });
      }
    }

    simRef.current?.stop();
    simRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [data]);

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
    (_event: React.MouseEvent, node: Node<MemberNodeData>) => {
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
    (_event: React.MouseEvent, node: Node<MemberNodeData>) => {
      const simNode = simNodesByIdRef.current.get(node.id);
      const sim = flowPositionToSim(node.position);
      if (!simNode || !sim) return;
      simNode.fx = sim.x;
      simNode.fy = sim.y;
    },
    [flowPositionToSim],
  );
  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node<MemberNodeData>) => {
    const simNode = simNodesByIdRef.current.get(node.id);
    if (simNode) {
      simNode.fx = null;
      simNode.fy = null;
    }
    // Release the alpha target so the sim cools normally back to rest.
    simRef.current?.alphaTarget(0);
    draggedNodeIdRef.current = null;
  }, []);

  // Canvas height animation. Width is CSS-driven (w-full, capped to the
  // viewport height); we measure the resulting width and use it as the
  // square's height in view mode, collapsing to EDIT_HEIGHT in edit mode.
  const [graphWidth, setGraphWidth] = useState(0);
  const lastWidthRef = useRef(0);
  // Transition is armed for mode toggles but disarmed for the initial measure
  // and for resizes, so the box tracks the window instantly rather than easing.
  const [animateHeight, setAnimateHeight] = useState(false);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  // Callback ref: attach the observer once the graph element mounts (it only
  // renders after the loading/empty early-returns below).
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    resizeObsRef.current?.disconnect();
    if (!el) {
      resizeObsRef.current = null;
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      // Ignore height-only changes (our own animation); only width changes
      // (resize) re-derive the square's height, and should do so instantly.
      if (Math.abs(w - lastWidthRef.current) < 0.5) return;
      lastWidthRef.current = w;
      setAnimateHeight(false);
      setGraphWidth(w);
    });
    ro.observe(el);
    resizeObsRef.current = ro;
  }, []);

  // Re-arm the transition one frame after the initial measure or a resize, so
  // the next mode toggle eases but the size change that just committed didn't.
  useEffect(() => {
    if (graphWidth > 0 && !animateHeight) {
      const id = requestAnimationFrame(() => setAnimateHeight(true));
      return () => cancelAnimationFrame(id);
    }
  }, [graphWidth, animateHeight]);

  // On a mode toggle, re-fit every frame for the duration of the height
  // transition so the graph zooms to match the shrinking/growing box. The
  // height eases via CSS, so fitting to the current box each frame inherits
  // that easing. Skips the first run (initial mount fits via the sim).
  const firstModeRef = useRef(true);
  // `square` is the trigger, not a read value — the effect must re-run each
  // time the mode flips so the fit follows the height transition.
  // biome-ignore lint/correctness/useExhaustiveDependencies: square triggers the per-toggle re-fit
  useEffect(() => {
    if (firstModeRef.current) {
      firstModeRef.current = false;
      return;
    }
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now: number) {
      flowRef.current?.fitView({ padding: 0.15, duration: 0 });
      raf = now - start < MODE_ANIM_MS + 60 ? requestAnimationFrame(tick) : 0;
    });
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [square]);

  // Edge-number reveal. Numbers stay hidden until shown one of two ways:
  //   - hover (desktop): a transient preview while the pointer is on the line
  //     or the number, cleared on leave. Suppressed while an edge is selected,
  //     so a selection doesn't spawn previews as you move around.
  //   - selection (click/tap): clicking a line selects it and shows its number
  //     until a click on the pane, a node, or another line. A second click on
  //     the selected line — or a click on the number — opens the relating dialog.
  // endPreviewSoon defers the hover hide briefly so the pointer can travel
  // from the line onto the number; previewEdge (the number's own mouseenter)
  // cancels that pending hide.
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // Mirror of selectedEdgeId for the stable previewEdge callback to read
  // without re-creating each time the selection changes.
  const selectedEdgeRef = useRef<string | null>(null);
  useEffect(() => {
    selectedEdgeRef.current = selectedEdgeId;
  }, [selectedEdgeId]);
  const previewTimer = useRef<number | null>(null);
  const clearPreviewTimer = useCallback(() => {
    if (previewTimer.current !== null) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
  }, []);
  const previewEdge = useCallback(
    (edgeId: string) => {
      if (selectedEdgeRef.current !== null) return; // hover off while an edge is selected
      clearPreviewTimer();
      setHoverEdgeId(edgeId);
    },
    [clearPreviewTimer],
  );
  const endPreviewSoon = useCallback(() => {
    clearPreviewTimer();
    previewTimer.current = window.setTimeout(() => setHoverEdgeId(null), 120);
  }, [clearPreviewTimer]);
  const clearSelection = useCallback(() => {
    clearPreviewTimer();
    setHoverEdgeId(null);
    setSelectedEdgeId(null);
  }, [clearPreviewTimer]);
  useEffect(() => clearPreviewTimer, [clearPreviewTimer]);

  const edgeInteraction = useMemo<EdgeInteraction>(
    () => ({ openRelating: onOpenRelating, hoverEdgeId, selectedEdgeId, previewEdge, endPreviewSoon }),
    [onOpenRelating, hoverEdgeId, selectedEdgeId, previewEdge, endPreviewSoon],
  );

  // A selected, editable edge gets cursor:pointer on its whole hit area —
  // ReactFlow merges this className onto the edge's <g>, and cursor inherits
  // down to the visible path and the wider invisible interaction path, so the
  // line (not just the number) signals it's clickable. Only the selected edge
  // is re-spread, so this stays a cheap per-selection diff.
  const edgesWithCursor = useMemo(
    () => edges.map((e) => (e.id === selectedEdgeId && e.data?.isOutgoing ? { ...e, className: "cursor-pointer" } : e)),
    [edges, selectedEdgeId],
  );

  const empty = !data || data.nodes.length === 0;

  if (isPending) {
    return <p className="text-base text-muted-foreground">Loading your web…</p>;
  }
  if (isError) {
    return (
      <p role="alert" className="text-base text-destructive">
        Couldn&apos;t load your web.
      </p>
    );
  }
  if (empty) {
    return (
      <p className="text-base text-muted-foreground">
        No connections yet — start relating to members in Edit mode and they&apos;ll appear here.
      </p>
    );
  }

  // Width is identical in both modes — w-full capped to the viewport height,
  // free of the page's max-w-5xl wrapper so on tall displays the square grows
  // past 1024px. Only the height differs: the measured width (a square) in
  // view mode, EDIT_HEIGHT in edit mode. Animating just the height keeps the
  // box from ever widening on the toggle; the top stays put, so the bottom
  // edge is what travels.
  const heightPx = graphWidth > 0 ? (square ? graphWidth : Math.min(graphWidth, EDIT_HEIGHT)) : undefined;

  return (
    <div
      ref={measureRef}
      data-tour="graph"
      style={{
        height: heightPx ? `${heightPx}px` : undefined,
        transition: animateHeight ? `height ${MODE_ANIM_MS}ms ${MODE_ANIM_EASE}` : undefined,
      }}
      className="mx-auto w-full max-w-[calc(100vh_-_12rem)] overflow-hidden rounded border border-border bg-canvas [--xy-background-color:var(--color-canvas)]"
    >
      <EdgeInteractionContext.Provider value={edgeInteraction}>
        <ReactFlow
          nodes={nodes}
          edges={edgesWithCursor}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          onInit={(instance) => {
            flowRef.current = instance;
          }}
          // Hover previews a number on desktop (off while an edge is selected).
          onEdgeMouseEnter={(_event, edge) => previewEdge(edge.id)}
          onEdgeMouseLeave={() => endPreviewSoon()}
          // Click/tap a line selects it and shows its number; a second click on
          // the selected line opens the relating dialog (clicking the number
          // does the same). Tap within the edge's interactionWidth (±5px) on mobile.
          onEdgeClick={(_event, edge) => {
            clearPreviewTimer();
            if (selectedEdgeId === edge.id) {
              const d = edge.data;
              if (d?.isOutgoing) {
                onOpenRelating({
                  id: d.relateeId,
                  displayName: d.relateeName,
                  currentValue: isRelationValue(d.value) ? d.value : null,
                });
              }
              return;
            }
            setSelectedEdgeId(edge.id);
          }}
          onPaneClick={() => clearSelection()}
          onMove={(event) => {
            // Programmatic fitView calls pass event=null; only flip the
            // flag on user gestures (MouseEvent / TouchEvent / Wheel).
            if (event !== null) userMovedViewportRef.current = true;
          }}
          onNodesChange={onNodesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_event, node) => {
            // A click on a node counts as "elsewhere" — clear any edge
            // selection. Then re-center the viewport on the clicked node so
            // members can explore the graph without navigating away.
            // Double-click navigates to the member's profile page.
            clearSelection();
            flowRef.current?.setCenter(node.position.x, node.position.y, {
              zoom: flowRef.current.getZoom(),
              duration: 400,
            });
          }}
          onNodeDoubleClick={(_event, node) => {
            const slug = node.data.slug ?? node.data.id;
            router.push(`/members/${slug}`);
          }}
        >
          {/* Built-in +/-/fit-view buttons for users who can't or don't
           * want to scroll-zoom (trackpad pinch, mouse wheel). Lock toggle
           * is hidden — selection and connection are already disabled. */}
          <Controls position="top-left" showInteractive={false} />
          <Panel position="bottom-right" className="flex flex-row-reverse items-end gap-2">
            {/* Click-to-toggle (not hover) so the hints stay reachable on
             * touch devices where hover doesn't exist. */}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={hintOpen ? "Hide canvas tips" : "Show canvas tips"}
              aria-expanded={hintOpen}
              aria-controls="web-graph-hints"
              onClick={() => setHintOpen((h) => !h)}
              className="rounded-full border border-border bg-background/90 font-bold"
            >
              ?
            </Button>
            {hintOpen && (
              <div
                id="web-graph-hints"
                className="flex max-w-[18rem] flex-col gap-2 rounded border border-border bg-background/90 p-2 text-sm text-muted-foreground"
              >
                <ul className="flex flex-col gap-1">
                  <li>Drag the background to pan.</li>
                  <li>Drag a circle to reposition it.</li>
                  <li>Scroll or pinch to zoom.</li>
                  <li>Single-click a circle to center the view on it.</li>
                  <li>Double-click a circle to open their profile.</li>
                  <li>
                    <span className="font-medium text-foreground">2 hops</span> adds friends-of-friends.
                  </li>
                </ul>
                <button
                  type="button"
                  onClick={() => {
                    setHintOpen(false);
                    onReplayTour();
                  }}
                  className="self-start text-foreground underline underline-offset-2 hover:text-primary"
                >
                  Replay guided tour
                </button>
              </div>
            )}
          </Panel>
          <Panel
            position="top-right"
            className="flex flex-col gap-1 rounded border border-border bg-background/90 p-2 text-sm"
          >
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={view.hops === 2}
                onChange={(e) => setView((v) => ({ ...v, hops: e.target.checked ? 2 : 1 }))}
              />
              2 hops
            </label>
          </Panel>
        </ReactFlow>
      </EdgeInteractionContext.Provider>
    </div>
  );
}
