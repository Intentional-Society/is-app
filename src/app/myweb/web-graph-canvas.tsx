"use client";

import "@xyflow/react/dist/style.css";

import { type Edge, type EdgeMouseHandler, type Node, type NodeMouseHandler, ReactFlow } from "@xyflow/react";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useMemo } from "react";

import { FIT_VIEW_PADDING, useWebGraphSimulation } from "./use-web-graph-simulation";
import { edgeStrokeOpacity, edgeStrokeWidth } from "./web-graph-layout";
import {
  type EdgeData,
  type EdgeInteraction,
  EdgeInteractionContext,
  edgeTypes,
  type MemberNodeData,
  type NodeInteraction,
  NodeInteractionContext,
  nodeTypes,
  type SubgraphNode,
} from "./web-graph-renderers";
import { decorateEdges, decorateNodes } from "./web-graph-selection";

// The reusable rendering surface beneath WebGraph: it owns the d3-force layout,
// the ReactFlow canvas, the member/edge renderer contexts, and the lit/dim
// decoration. The full graph (WebGraph) and a future controls-free mini-map both
// drive it — they differ only in the data, which node plays which role, and how
// the lit path is computed (a click vs. a server response). Everything those two
// share lives here; everything they don't (fetch, chrome, selection state) stays
// in the wrapper, which hands its results in as props.

// The subgraph the canvas lays out and draws. The three layout roles are
// independent so a caller can emphasize a node without pinning it (the mini-map
// floats its layout around the profile member); viewerId decides which edges
// read as outgoing/editable. WebGraph passes the same id for all four.
export type WebGraphCanvasSubgraph = {
  nodes: readonly SubgraphNode[];
  edges: readonly { relatorId: string; relateeId: string; value: number }[];
  // Edges leaving this node are "outgoing" — editable, and clickable to open the
  // relating dialog. The viewing member.
  viewerId: string;
  // The radial-seed root, the pinned origin, and the larger avatar. See
  // useWebGraphSimulation / MemberNode.
  rootId: string;
  pinnedNodeId: string | null;
  emphasizedNodeId: string | null;
};

type WebGraphCanvasProps = {
  subgraph: WebGraphCanvasSubgraph;
  // Lit (success-green) node/edge ids and whether to dim everything off them.
  // WebGraph derives these from a click; the mini-map from the server path.
  litNodeIds: ReadonlySet<string>;
  litEdgeIds: ReadonlySet<string>;
  dimUnlit: boolean;
  // The clicked node (kept at hover size) and the selected editable edge
  // (cursor:pointer). Both null in read-only views like the mini-map.
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  // Marks one node with a small "You" cue (the mini-map's viewer at the end of
  // the lit path). Null in the full graph, where you're obviously the center.
  viewerCueNodeId?: string | null;
  // Edge-number reveal + relating-dialog wiring. Built by the wrapper that owns
  // the hover/selection state machine; null in read-only views (no numbers, no
  // editing).
  edgeInteraction?: EdgeInteraction | null;
  // Fraction of the canvas kept as breathing room on every fitView.
  fitViewPadding?: number;
  // When false, pan/zoom/drag are locked (the mini-map never hijacks page
  // scroll). Defaults to the fully-interactive full graph.
  interactive?: boolean;
  // Handed the layout's fitView once the canvas mounts, so the wrapper can refit
  // during its own animations (WebGraph's view↔edit height transition).
  onReady?: (fitView: () => void) => void;
  // ReactFlow interaction handlers — the wrapper decides what a click means
  // (WebGraph: select/edit; mini-map: navigate). Drag, pan-tracking, and node
  // changes are owned internally because they belong to the layout.
  onEdgeMouseEnter?: EdgeMouseHandler<Edge<EdgeData>>;
  onEdgeMouseLeave?: EdgeMouseHandler<Edge<EdgeData>>;
  onEdgeClick?: EdgeMouseHandler<Edge<EdgeData>>;
  onPaneClick?: (event: ReactMouseEvent) => void;
  onNodeClick?: NodeMouseHandler<Node<MemberNodeData>>;
  onNodeDoubleClick?: NodeMouseHandler<Node<MemberNodeData>>;
  // Corner panels (Controls, hints, view controls) rendered inside ReactFlow.
  children?: ReactNode;
};

export function WebGraphCanvas({
  subgraph,
  litNodeIds,
  litEdgeIds,
  dimUnlit,
  selectedNodeId,
  selectedEdgeId,
  viewerCueNodeId = null,
  edgeInteraction = null,
  fitViewPadding = FIT_VIEW_PADDING,
  interactive = true,
  onReady,
  onEdgeMouseEnter,
  onEdgeMouseLeave,
  onEdgeClick,
  onPaneClick,
  onNodeClick,
  onNodeDoubleClick,
  children,
}: WebGraphCanvasProps) {
  // Base ReactFlow edges, rebuilt whenever the subgraph changes. Outgoing edges
  // (from the viewer) carry the relatee identity the relating dialog needs.
  const baseEdges = useMemo<Edge<EdgeData>[]>(() => {
    const { viewerId, nodes, edges } = subgraph;
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    return edges.map((e) => {
      const isOutgoing = e.relatorId === viewerId;
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
          // Eases the stroke recolor when a node selection dims edges off the
          // lit path (blend toward canvas) or paints them success-green on it.
          transition: "stroke 150ms ease",
        },
        data: {
          isOutgoing,
          value: e.value,
          relateeId: e.relateeId,
          relateeName: relatee?.displayName ?? null,
        },
      };
    });
  }, [subgraph]);

  // The d3-force layout: builds the simulation over the subgraph, paints
  // normalized render positions into `nodes`, fits the viewport as it settles,
  // and integrates node dragging. See useWebGraphSimulation.
  const { nodes, onNodesChange, onNodeDragStart, onNodeDrag, onNodeDragStop, registerFlow, markUserMoved, fitView } =
    useWebGraphSimulation(subgraph, fitViewPadding);

  // Surface fitView to the wrapper once (the hook returns a stable callback).
  useEffect(() => onReady?.(fitView), [onReady, fitView]);

  // Carries the node decoration to MemberNode via context (kept out of node.data
  // so a selection doesn't trigger a setNodes pass). See NodeInteraction.
  const nodeInteraction = useMemo<NodeInteraction>(
    () => ({ litNodeIds, dimUnlit, selectedNodeId, viewerCueNodeId }),
    [litNodeIds, dimUnlit, selectedNodeId, viewerCueNodeId],
  );

  // Light the selected edge and the lit path; dim the rest when asked. The
  // stroke transition on the base style eases the recolor. See decorateEdges.
  const decoratedEdges = useMemo(
    () => decorateEdges(baseEdges, { litEdgeIds, dimUnlit, selectedEdgeId }),
    [baseEdges, litEdgeIds, dimUnlit, selectedEdgeId],
  );

  // Lift the lit nodes above the dimmed graph; derived from the live `nodes`
  // state so sim ticks and drags flow through untouched. See decorateNodes.
  const decoratedNodes = useMemo(() => decorateNodes(nodes, { litNodeIds }), [nodes, litNodeIds]);

  // Read-only embed config: lock every gesture so the canvas never steals page
  // scroll, and drop minZoom well below ReactFlow's 0.5 default so fitView can
  // zoom out far enough to honor the (roomier) padding — otherwise a small, wide
  // graph in a narrow box bottoms out at 0.5 and fills the frame edge-to-edge.
  // Omitted entirely when interactive, leaving ReactFlow's defaults intact.
  const lockProps = interactive
    ? undefined
    : {
        zoomOnScroll: false,
        zoomOnPinch: false,
        zoomOnDoubleClick: false,
        panOnDrag: false,
        panOnScroll: false,
        nodesDraggable: false,
        minZoom: 0.1,
      };

  return (
    <EdgeInteractionContext.Provider value={edgeInteraction}>
      <NodeInteractionContext.Provider value={nodeInteraction}>
        <ReactFlow
          {...lockProps}
          nodes={decoratedNodes}
          edges={decoratedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: fitViewPadding }}
          onInit={registerFlow}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onMove={(event) => {
            // Programmatic fitView calls pass event=null; only flag a user
            // gesture (MouseEvent / TouchEvent / Wheel).
            if (event !== null) markUserMoved();
          }}
          onNodesChange={onNodesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
        >
          {children}
        </ReactFlow>
      </NodeInteractionContext.Provider>
    </EdgeInteractionContext.Provider>
  );
}
