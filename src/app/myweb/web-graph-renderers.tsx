"use client";

import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getStraightPath,
  Handle,
  type Node,
  type NodeProps,
  Position,
} from "@xyflow/react";
import { createContext, useContext } from "react";

import { Avatar } from "@/components/avatar";
import type { RelationSubgraph } from "@/lib/api-types";
import { isRelationValue } from "@/lib/relation-value";

import type { RelatingTarget } from "./relating-dialog";
import { DIM_KEEP, EDGE_LABEL_Z } from "./web-graph-selection";

// The two custom ReactFlow renderers — the member node and the numbered edge —
// plus the data shapes they read and the interaction contexts WebGraph fills.
// Node and edge mirror each other: each consumes a context the parent provides,
// which keeps per-selection / per-hover state out of the node/edge data objects
// (and so out of the memos that build them).

export type SubgraphNode = RelationSubgraph["nodes"][number];

export type MemberNodeData = SubgraphNode & {
  // Drawn larger with a primary-colored border. WebGraph emphasizes you; the
  // mini-map will emphasize the profile member.
  emphasized: boolean;
};

export type EdgeData = {
  isOutgoing: boolean;
  value: number;
  relateeId: string;
  relateeName: string | null;
};

// Handles are required for ReactFlow to anchor edges; rendering both at
// the same vertically-centered position with opacity 0 makes edges read
// as center-to-center lines without showing connector dots.
const HANDLE_STYLE = { opacity: 0, top: "50%", pointerEvents: "none" as const };

// DIM_KEEP (the fraction a dimmed element keeps) lives in web-graph-selection
// alongside the decoration that applies it; MemberNode reuses it for the avatar
// and name washes so a node dims by the same amount as its edges.

// Carries the node decoration to MemberNode (rendered via nodeTypes) without
// baking it into node.data — that would force a setNodes pass per change and
// tangle with the sim's position updates. Mirrors EdgeInteractionContext.
export type NodeInteraction = {
  // Nodes drawn lit (success-green border). WebGraph passes the clicked node's
  // path back to you; the mini-map passes the server's path-to-you.
  litNodeIds: ReadonlySet<string>;
  // Dim every node not in litNodeIds (see DIM_KEEP). WebGraph dims off-path on a
  // click; the mini-map leaves the rest at full strength.
  dimUnlit: boolean;
  // The clicked node, kept at hover size so a selection reads as "this one's it."
  // Null in read-only views (the mini-map navigates on click instead).
  selectedNodeId: string | null;
  // Nodes whose name label is shown. Names are hidden by default and revealed
  // for the lit path (a node selection) plus transient hover — a node, or a
  // connected edge (its two endpoints); everything else stays nameless. Mirrors
  // the edge-number reveal. WebGraph builds the set.
  labeledNodeIds: ReadonlySet<string>;
  // The viewer's node — its name label reads "You" in place of the member name
  // (how the mini-map marks you). Null in the full graph, where you're the
  // obvious center.
  viewerCueNodeId: string | null;
};
export const NodeInteractionContext = createContext<NodeInteraction | null>(null);

function MemberNode({ id, data }: NodeProps<Node<MemberNodeData>>) {
  const selection = useContext(NodeInteractionContext);
  const isSelected = selection?.selectedNodeId === id;
  const isViewer = selection?.viewerCueNodeId === id;
  // Names are hidden by default; this node's shows only while it's labeled
  // (lit path, or hovered directly / via a connected edge).
  const labeled = selection?.labeledNodeIds.has(id) === true;
  // When dimming is on, every node off the lit set dims (see DIM_KEEP).
  const isDimmed = selection?.dimUnlit === true && !selection.litNodeIds.has(id);
  // Every lit node gets the green border to match the links; otherwise the
  // emphasized node is primary-teal, rest default.
  const onLitPath = selection?.litNodeIds.has(id) === true;
  const borderClass = onLitPath ? "border-success" : data.emphasized ? "border-primary" : "border-border";
  return (
    // Only the Avatar is a click target: the wrapper is pointer-events-none and
    // .react-flow__node is !pointer-events-none (set per-node above), so clicks on
    // the name and the corners around the round avatar fall through as inert.
    <div className="pointer-events-none flex flex-col items-center gap-1">
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Top} style={HANDLE_STYLE} />
      {/* Avatar + its dim wash share this box so they scale together on
          hover/select (no half-dimmed ring). */}
      <div className={`relative transition-transform duration-150 hover:scale-110 ${isSelected ? "scale-110" : ""}`}>
        <Avatar
          name={data.displayName}
          url={data.avatarUrl}
          className={`pointer-events-auto flex cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 [clip-path:circle()] ${
            data.emphasized ? "h-16 w-16" : "h-12 w-12"
          } ${borderClass} bg-muted text-base font-semibold text-muted-foreground`}
        />
        {/* Dim wash clipped to the avatar circle (rounded-full, never a square
            over the edges behind), blended over the opaque avatar so endpoints
            behind it stay hidden. pointer-events-none lets clicks reach it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full bg-canvas transition-opacity duration-150"
          style={{ opacity: isDimmed ? 1 - DIM_KEEP : 0 }}
        />
      </div>
      {/* Hidden by default, faded in when labeled (hover or lit path). Kept
          mounted at opacity 0 rather than unmounted so the node's height never
          shifts as names appear (no reflow against the fixed layout). The
          viewer's own node reads "You" in place of their name (mini-map cue). */}
      <div
        aria-hidden={!labeled}
        className="pointer-events-none max-w-[8rem] truncate text-sm font-medium transition-opacity duration-150"
        style={{
          opacity: labeled ? 1 : 0,
          // Canvas-colored halo so the name reads over the dense edge lines
          // behind it — those strokes are canvas-foreground, the same color
          // family as the text, so without a moat the glyphs blend in.
          // paint-order:stroke draws the stroke behind the fill, so it's a true
          // outline (glyphs stay crisp) rather than a thinned weight.
          paintOrder: "stroke",
          WebkitTextStroke: "3px var(--color-canvas)",
        }}
      >
        {isViewer ? "You" : (data.displayName ?? "—")}
      </div>
    </div>
  );
}

export const nodeTypes = { member: MemberNode };

// Carries edge-number reveal state + the relating callback to the
// NumberedEdge instances without threading them through the edge data object
// (which would defeat the edges useMemo). The Provider wraps ReactFlow so
// context still reaches the edges registered via the edgeTypes prop.
export type EdgeInteraction = {
  openRelating: (target: RelatingTarget) => void;
  // Transient hover preview (desktop) and the selected edge (click/tap). A
  // number shows when its id matches either.
  hoverEdgeId: string | null;
  selectedEdgeId: string | null;
  // The selected node's lit path-to-center edges, whose numbers also show so a
  // highlighted path reads its relation values. Direction-stamped both ways, so
  // an edge id (one direction) matches by set membership. Empty when no node is
  // selected.
  litEdgeIds: ReadonlySet<string>;
  previewEdge: (id: string) => void;
  endPreviewSoon: () => void;
};
export const EdgeInteractionContext = createContext<EdgeInteraction | null>(null);

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
  const isVisible =
    interaction !== null &&
    (interaction.hoverEdgeId === id || interaction.selectedEdgeId === id || interaction.litEdgeIds.has(id));
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
            // Lift the revealed pill above the hover tier so its halo never tucks
            // under a lifted avatar. The edge-label layer is stacking-transparent,
            // so this competes in the viewport (see EDGE_LABEL_Z). Hidden pills
            // stay at auto — they're invisible and capture no clicks anyway.
            zIndex: isVisible ? EDGE_LABEL_Z : undefined,
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

export const edgeTypes = { numbered: NumberedEdge };
