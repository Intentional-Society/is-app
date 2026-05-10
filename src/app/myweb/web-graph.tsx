"use client";

import "@xyflow/react/dist/style.css";

import { useQuery } from "@tanstack/react-query";
import { type Edge, type Node, type NodeProps, Panel, ReactFlow } from "@xyflow/react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation } from "d3-force";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "@/components/avatar";
import { apiClient } from "@/lib/api";
import type { RelationSubgraph } from "@/lib/api-types";

import { RELATION_SUBGRAPH_QUERY_KEY } from "./query-keys";
import type { RatingTarget } from "./rating-dialog";

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

type EdgeData = {
  isOutgoing: boolean;
  value: number;
  relateeId: string;
  relateeName: string | null;
};

type ViewOptions = {
  includeIncoming: boolean;
  hops: 1 | 2;
};

const DEFAULT_VIEW: ViewOptions = { includeIncoming: false, hops: 2 };

const fetchSubgraph = async (opts: ViewOptions) => {
  const res = await apiClient.api.relations.subgraph.$get({
    query: {
      in: opts.includeIncoming ? "true" : "false",
      hops: String(opts.hops),
    },
  });
  if (!res.ok) throw new Error(`relations/subgraph: ${res.status}`);
  return res.json();
};

// 1..4 → edge thickness; chosen so a 4-rated friend reads visually
// distinct from a 1-rated acquaintance without dominating the canvas.
const edgeStrokeWidth = (value: number) => 1.5 + value * 1.25;

function MemberNode({ data }: NodeProps<Node<MemberNodeData>>) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Avatar
        name={data.displayName}
        url={data.avatarUrl}
        className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 ${
          data.isCenter ? "border-primary" : "border-border"
        } bg-muted text-base font-semibold text-muted-foreground`}
      />
      <div className="max-w-[8rem] truncate text-sm font-medium">{data.displayName ?? "—"}</div>
    </div>
  );
}

const nodeTypes = { member: MemberNode };

export function WebGraph({ onOpenRating }: { onOpenRating: (target: RatingTarget) => void }) {
  const router = useRouter();
  const [view, setView] = useState<ViewOptions>(DEFAULT_VIEW);
  // The view options become part of the query key so toggling refetches
  // automatically and the rating-mutation invalidator (which uses the
  // bare ["relations", "subgraph"] key) still hits every variant.
  const { data, isPending, isError } = useQuery({
    queryKey: [...RELATION_SUBGRAPH_QUERY_KEY, view] as const,
    queryFn: () => fetchSubgraph(view),
  });

  const [nodes, setNodes] = useState<Node<MemberNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge<EdgeData>[]>([]);
  const simRef = useRef<Simulation<SimNode, SimEdge> | null>(null);

  // Build (or rebuild) the d3-force simulation whenever the subgraph
  // changes. The viewing member is pinned at the origin so the layout
  // always orients around them.
  useEffect(() => {
    if (!data) return;
    const centerId = data.centerId;
    const nodeById = new Map(data.nodes.map((n) => [n.id, n]));

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

    setNodes(
      data.nodes.map((n) => {
        const sn = simNodes.find((s) => s.id === n.id);
        return {
          id: n.id,
          type: "member",
          position: { x: sn?.x ?? 0, y: sn?.y ?? 0 },
          data: { ...n, isCenter: n.id === centerId },
          draggable: true,
        };
      }),
    );
    setEdges(
      data.edges.map((e) => {
        const isOutgoing = e.relatorId === centerId;
        const relatee = nodeById.get(e.relateeId);
        return {
          id: `${e.relatorId}->${e.relateeId}`,
          source: e.relatorId,
          target: e.relateeId,
          style: {
            strokeWidth: edgeStrokeWidth(e.value),
            cursor: isOutgoing ? "pointer" : "default",
          },
          data: {
            isOutgoing,
            value: e.value,
            relateeId: e.relateeId,
            relateeName: relatee?.displayName ?? null,
          },
        };
      }),
    );

    const sim = forceSimulation(simNodes)
      .force("charge", forceManyBody().strength(-500))
      .force(
        "link",
        forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.id)
          .distance(140),
      )
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

  const empty = useMemo(() => !data || data.nodes.length === 0, [data]);

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
        onNodeClick={(_event, node) => {
          // Center node has no profile destination distinct from "you
          // are here" — clicking yourself is a no-op.
          if (node.data.isCenter) return;
          const slug = node.data.slug ?? node.data.id;
          router.push(`/members/${slug}`);
        }}
        onEdgeClick={(_event, edge) => {
          // Re-rate is only available on edges I authored. Incoming-only
          // edges (someone else rated me, I haven't reciprocated) route
          // through the suggestion feed instead.
          const data = edge.data as EdgeData | undefined;
          if (!data?.isOutgoing) return;
          const validValue =
            data.value === 1 || data.value === 2 || data.value === 3 || data.value === 4 ? data.value : null;
          onOpenRating({
            id: data.relateeId,
            displayName: data.relateeName,
            currentValue: validValue,
          });
        }}
      >
        <Panel
          position="top-right"
          className="flex flex-col gap-1 rounded border border-border bg-background/90 p-2 text-sm"
        >
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={view.includeIncoming}
              onChange={(e) => setView((v) => ({ ...v, includeIncoming: e.target.checked }))}
            />
            Show incoming
          </label>
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
    </div>
  );
}
