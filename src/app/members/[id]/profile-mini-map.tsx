"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { relationMiniMapQueryKey } from "@/app/myweb/query-keys";
import { WebGraphCanvas } from "@/app/myweb/web-graph-canvas";
import { apiClient } from "@/lib/api";
import type { RelationMiniMap } from "@/lib/api-types";

// A read-only embed of WebGraphCanvas for a member's profile: the member
// (emphasized, unpinned), their strong connections, and the viewer's lit path
// back to them. The canvas does all the rendering; this only fetches, derives
// the lit sets, and wires a click to navigate.

// Roomier than the full graph's 0.10: nodes render at a fixed pixel size that
// fitView's padding doesn't scale, so a wide path at a narrow (mobile) width
// needs extra margin to keep the end avatars and their labels off the edges.
const MINI_MAP_FIT_PADDING = 0.12;

// Tighter than the full graph's 600: the longer axis normalizes to fewer sim
// units, so fitView zooms in and the fixed-px avatars and names render larger in
// this small embed. Trades a little link breathing room for legibility.
const MINI_MAP_NORMALIZATION_TARGET = 280;

const fetchMiniMap = async (profileId: string): Promise<RelationMiniMap> => {
  const res = await apiClient.api.relations["mini-map"][":profileId"].$get({ param: { profileId } });
  if (!res.ok) throw new Error(`relations/mini-map: ${res.status}`);
  return res.json();
};

// Edge ids on the path, stamped both directions (we don't know which way each
// stored edge runs) so set-membership lights whichever exists. Mirrors
// pathToCenter in web-graph-selection.
const pathEdgeIds = (path: readonly string[]): Set<string> => {
  const ids = new Set<string>();
  for (let i = 0; i + 1 < path.length; i++) {
    ids.add(`${path[i]}->${path[i + 1]}`);
    ids.add(`${path[i + 1]}->${path[i]}`);
  }
  return ids;
};

// Square so the page reserves the same footprint in loading / error / rendered
// states. bg-canvas + the xy var match the full graph's canvas surface.
const BOX_CLASS =
  "aspect-square w-full overflow-hidden rounded border border-border bg-canvas [--xy-background-color:var(--color-canvas)]";

export function ProfileMiniMap({ profileId, memberName }: { profileId: string; memberName: string | null }) {
  const router = useRouter();
  const { data, isPending, isError } = useQuery({
    queryKey: relationMiniMapQueryKey(profileId),
    queryFn: () => fetchMiniMap(profileId),
  });

  const litNodeIds = useMemo(() => new Set(data?.pathToViewer ?? []), [data?.pathToViewer]);
  const litEdgeIds = useMemo(() => pathEdgeIds(data?.pathToViewer ?? []), [data?.pathToViewer]);
  // This embed is a static, read-only diagram with no hover, so every node keeps
  // its name (the full graph hides names until hover/selection instead). Pass the
  // whole id set so the canvas labels them all.
  const labeledNodeIds = useMemo(() => new Set((data?.nodes ?? []).map((n) => n.id)), [data?.nodes]);
  // Memoized so the canvas's layout effect (keyed on the subgraph) doesn't
  // rebuild the simulation on every render.
  const subgraph = useMemo(
    () =>
      data
        ? {
            nodes: data.nodes,
            edges: data.edges,
            viewerId: data.viewerId,
            // The member is the layout root and the emphasized (larger) node, and
            // nothing is pinned — d3-force floats the layout around them.
            rootId: data.emphasizedId,
            pinnedNodeId: null,
            emphasizedNodeId: data.emphasizedId,
          }
        : null,
    [data],
  );

  if (isError) {
    return (
      <div className={`${BOX_CLASS} flex items-center justify-center`}>
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load the map.
        </p>
      </div>
    );
  }
  if (isPending || !subgraph) {
    return (
      <div className={`${BOX_CLASS} flex items-center justify-center`}>
        <p className="text-sm text-muted-foreground">Loading map…</p>
      </div>
    );
  }

  return (
    <div className={BOX_CLASS} role="img" aria-label={`Your relational path to ${memberName ?? "this member"}`}>
      <WebGraphCanvas
        subgraph={subgraph}
        litNodeIds={litNodeIds}
        litEdgeIds={litEdgeIds}
        dimUnlit={false}
        labeledNodeIds={labeledNodeIds}
        selectedNodeId={null}
        viewerCueNodeId={subgraph.viewerId}
        interactive={false}
        fitViewPadding={MINI_MAP_FIT_PADDING}
        normalizationTarget={MINI_MAP_NORMALIZATION_TARGET}
        // Read-only: a click opens the member's profile (no selection state).
        onNodeClick={(_event, node) => {
          const slug = node.data.slug ?? node.data.id;
          router.push(`/members/${slug}`);
        }}
      />
    </div>
  );
}
