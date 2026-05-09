"use client";

import "@xyflow/react/dist/style.css";

import { ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from "d3-force";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiClient } from "@/lib/api";
import type { RelationSubgraph } from "@/lib/api-types";

import { RELATION_SUBGRAPH_QUERY_KEY } from "./query-keys";

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
  fx?: number | null;
  fy?: number | null;
};

type SimEdge = {
  source: string | SimNode;
  target: string | SimNode;
};

const fetchSubgraph = async () => {
  const res = await apiClient.api.relations.subgraph.$get();
  if (!res.ok) throw new Error(`relations/subgraph: ${res.status}`);
  return res.json();
};

// 1..4 → edge thickness; chosen so a 4-rated friend reads visually
// distinct from a 1-rated acquaintance without dominating the canvas.
const edgeStrokeWidth = (value: number) => 1.5 + value * 1.25;

const initials = (name: string | null) =>
  (name ?? "?")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

function MemberNode({ data }: NodeProps<Node<MemberNodeData>>) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 ${
          data.isCenter ? "border-primary" : "border-border"
        } bg-muted text-base font-semibold text-muted-foreground`}
      >
        {data.avatarUrl ? (
          // biome-ignore lint/performance/noImgElement: avatarUrl can come from any host
          <img src={data.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span>{initials(data.displayName)}</span>
        )}
      </div>
      <div className="max-w-[8rem] truncate text-sm font-medium">{data.displayName ?? "—"}</div>
    </div>
  );
}

const nodeTypes = { member: MemberNode };

export function WebGraph() {
  const { data, isPending, isError } = useQuery({
    queryKey: RELATION_SUBGRAPH_QUERY_KEY,
    queryFn: fetchSubgraph,
  });

  const [nodes, setNodes] = useState<Node<MemberNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const simRef = useRef<Simulation<SimNode, SimEdge> | null>(null);

  // Build (or rebuild) the d3-force simulation whenever the subgraph
  // changes. The viewing member is pinned at the origin so the layout
  // always orients around them.
  useEffect(() => {
    if (!data) return;
    const centerId = data.centerId;

    const simNodes: SimNode[] = data.nodes.map((n) => {
      const isCenter = n.id === centerId;
      return {
        id: n.id,
        x: isCenter ? 0 : (Math.random() - 0.5) * 200,
        y: isCenter ? 0 : (Math.random() - 0.5) * 200,
        fx: isCenter ? 0 : null,
        fy: isCenter ? 0 : null,
      };
    });
    const simEdges: SimEdge[] = data.edges.map((e) => ({
      source: e.relatorId,
      target: e.relateeId,
    }));

    // Initial node placement uses the seed positions above; the tick
    // handler then keeps ReactFlow's position state in sync with the
    // running simulation.
    setNodes(
      data.nodes.map((n) => {
        const sn = simNodes.find((s) => s.id === n.id);
        return {
          id: n.id,
          type: "member",
          position: { x: sn?.x ?? 0, y: sn?.y ?? 0 },
          data: { ...n, isCenter: n.id === centerId },
          // Drag is allowed but the simulation will pull undragged
          // nodes back; user can grab a node to nudge the layout.
          draggable: true,
        };
      }),
    );
    setEdges(
      data.edges.map((e) => ({
        id: `${e.relatorId}->${e.relateeId}`,
        source: e.relatorId,
        target: e.relateeId,
        style: { strokeWidth: edgeStrokeWidth(e.value) },
      })),
    );

    const sim = forceSimulation(simNodes)
      .force("charge", forceManyBody().strength(-500))
      .force("link", forceLink<SimNode, SimEdge>(simEdges).id((d) => d.id).distance(140))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide(40))
      .on("tick", () => {
        setNodes((prev) =>
          prev.map((node) => {
            const sn = simNodes.find((s) => s.id === node.id);
            if (!sn) return node;
            return { ...node, position: { x: sn.x, y: sn.y } };
          }),
        );
      });

    simRef.current?.stop();
    simRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [data]);

  // ReactFlow needs a fixed-height parent. Tailwind's h-[500px] keeps
  // the canvas tall enough to read at desktop widths without dominating
  // mobile.
  const empty = useMemo(() => !data || data.nodes.length === 0, [data]);

  if (isPending) {
    return <p className="text-base text-muted-foreground">Loading your web…</p>;
  }
  if (isError) {
    return <p role="alert" className="text-base text-destructive">Couldn&apos;t load your web.</p>;
  }
  if (empty) {
    // Smallest case — center hasn't rated anyone yet. Show a soft
    // pointer toward Edit mode rather than an empty canvas.
    return (
      <p className="text-base text-muted-foreground">
        No connections yet — start rating members in Edit mode and they&apos;ll appear here.
      </p>
    );
  }

  return (
    <div className="h-[500px] w-full rounded border border-border bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  );
}
