"use client";

import "@xyflow/react/dist/style.css";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Controls, Panel } from "@xyflow/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import { isRelationValue, type RelationValue } from "@/lib/relation-value";

import {
  DEFAULT_SUBGRAPH_VIEW,
  defaultValueFilter,
  parseStoredValueFilter,
  parseStoredView,
  RELATION_SUBGRAPH_QUERY_KEY,
  type RelationValueFilter,
  type SubgraphViewOptions,
  VALUE_FILTER_STORAGE_KEY,
  VIEW_STORAGE_KEY,
} from "./query-keys";
import type { RelatingTarget } from "./relating-dialog";
import { WebGraphCanvas } from "./web-graph-canvas";
import { WebGraphControls } from "./web-graph-controls";
import { filterSubgraphByValue } from "./web-graph-filtering";
import type { EdgeInteraction } from "./web-graph-renderers";
import { pathToCenter, shortestPathTree } from "./web-graph-selection";

const fetchSubgraph = async (opts: SubgraphViewOptions) => {
  const res = await apiClient.api.relations.subgraph.$get({
    query: {
      hops: String(opts.hops),
    },
  });
  if (!res.ok) throw new Error(`relations/subgraph: ${res.status}`);
  return res.json();
};

// View<->edit canvas sizing. View mode fills the available rectangle as fully as
// it can, clamping only its aspect ratio to the [3:4, 4:3] range — so a roughly
// square area is used whole, and only a viewport more extreme than 4:3 (wide
// desktop) or 3:4 (portrait phone) gets letterboxed in its long direction. Edit
// mode collapses to a shorter strip so the suggestion feed below stays on
// screen. Width is identical between modes — only the height animates on the
// toggle (top-anchored, so the bottom edge travels while ReactFlow re-fits each
// frame to scale the graph with the box).
const MAX_ASPECT = 4 / 3; // widest allowed (width:height) — 4:3 landscape
const MIN_ASPECT = 3 / 4; // tallest allowed (width:height) — 3:4 portrait
// Edit mode's strip is this fraction of the view-mode height, so it scales with
// the viewport (a taller window gets a taller strip) instead of a fixed px. The
// remaining ~40% leaves room for the suggestion feed below.
const EDIT_HEIGHT_FRACTION = 0.6;
// Space reserved below the canvas — the page's own padding (main's pb-8 / px-8,
// both 2rem) so the gap under the canvas matches the gap beside it. Resolved
// from the live root font-size rather than assuming 16px (the app sets it
// larger), so it lands on the same px the page padding uses; the canvas bottom
// then sits exactly pb-8 above the viewport floor, totalling 100vh, so view
// mode never spills into a vertical scrollbar. (Edit mode's feed legitimately
// scrolls — the no-scrollbar guarantee is a view-mode one.)
const PAGE_PAD_REM = 2;
const bottomReserve = () => PAGE_PAD_REM * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
const MODE_ANIM_MS = 1000;
const MODE_ANIM_EASE = "cubic-bezier(0.45, 0, 0.55, 1)"; // accelerate + decelerate

export function WebGraph({
  expanded,
  onOpenRelating,
  onReplayTour,
  mode,
  onEdit,
  onDone,
  donePending,
  doneError,
}: {
  // View mode expands the canvas to fill the available space (aspect clamped to
  // the 3:4–4:3 range); edit mode keeps the shorter strip so the suggestion feed
  // below stays in view.
  expanded: boolean;
  onOpenRelating: (target: RelatingTarget) => void;
  onReplayTour: () => void;
  // The Edit/Done toggle lives in the canvas's lower-left corner (a Panel
  // below), but its state and the mark-done mutation stay in MyWeb — passed
  // down here so the toggle travels with the graph chrome.
  mode: "edit" | "view";
  onEdit: () => void;
  onDone: () => void;
  donePending: boolean;
  doneError: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<SubgraphViewOptions>(DEFAULT_SUBGRAPH_VIEW);
  const [hintOpen, setHintOpen] = useState(false);
  // True once the mount effect has reconciled `view` with localStorage, and
  // true once the reconciled view's real data has landed — together they gate
  // the first paint (see the initialReady latch below).
  const [viewHydrated, setViewHydrated] = useState(false);
  const [initialReady, setInitialReady] = useState(false);
  // Which relation depths (1..4) are drawn. A client-side cull over the fetched
  // subgraph (see the `filtered` memo), so toggling re-filters instantly with no
  // refetch. Lazy init so the default Set isn't a shared module singleton.
  const [valueFilter, setValueFilter] = useState<RelationValueFilter>(defaultValueFilter);

  // Restore the user's last filter choice across reloads. Done in an
  // effect rather than the useState initializer so SSR-rendered markup
  // matches the hydrated client tree; the prefetched cache covers only
  // the default view, so this triggers a single client refetch when the
  // stored shape differs (placeholderData below suppresses the flash).
  useEffect(() => {
    const stored = parseStoredView(window.localStorage.getItem(VIEW_STORAGE_KEY));
    if (stored && stored.hops !== DEFAULT_SUBGRAPH_VIEW.hops) setView(stored);
    const storedFilter = parseStoredValueFilter(window.localStorage.getItem(VALUE_FILTER_STORAGE_KEY));
    if (storedFilter) setValueFilter(storedFilter);
    setViewHydrated(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
  }, [view]);

  useEffect(() => {
    window.localStorage.setItem(VALUE_FILTER_STORAGE_KEY, JSON.stringify([...valueFilter]));
  }, [valueFilter]);
  // The view options become part of the query key so toggling refetches
  // automatically and the relating-dialog's mutation invalidator (which uses the
  // bare ["relations", "subgraph"] key) still hits every variant.
  const { data, isPending, isError, isPlaceholderData } = useQuery({
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

  // Hold the first paint until the view reconciled from localStorage has its
  // own data — otherwise the prefetched default (2 hops) flashes for a beat
  // before a stored "1 hop" preference refetches and replaces it. isPlaceholderData
  // is true while keepPreviousData is showing the stale 2-hop result, so we wait
  // it out: a little extra latency in exchange for landing on the right layout.
  // One-way latch — once the initial load settles it never re-gates, so later
  // user toggles still get keepPreviousData's seamless swap.
  useEffect(() => {
    if (viewHydrated && !isPending && !isPlaceholderData) setInitialReady(true);
  }, [viewHydrated, isPending, isPlaceholderData]);

  // The relation-depth cull, applied before anything downstream reads the
  // subgraph: the layout, the rendered edges, and the selection path tree all
  // operate on this filtered view, so hiding a depth genuinely thins the web
  // (nodes the cull orphans leave) rather than just hiding lines. Shaped like
  // `data` so consumers swap straight over. See filterSubgraphByValue.
  const filtered = useMemo(() => {
    if (!data) return null;
    const sub = filterSubgraphByValue(data.nodes, data.edges, data.centerId, valueFilter);
    // You are the viewer and play all three layout roles — the radial-seed root,
    // the pinned origin, and the emphasized (larger) node. The mini-map splits
    // these (you stay the viewer; the profile member is root + emphasis).
    return {
      centerId: data.centerId,
      viewerId: data.centerId,
      nodes: sub.nodes,
      edges: sub.edges,
      rootId: data.centerId,
      pinnedNodeId: data.centerId,
      emphasizedNodeId: data.centerId,
    };
  }, [data, valueFilter]);

  // Flip one depth in/out of the filter. Each toggle is independent (not a
  // threshold) and a new Set keeps the state update immutable.
  const toggleValue = useCallback((value: RelationValue) => {
    setValueFilter((cur) => {
      const next = new Set(cur);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  // The canvas owns the d3-force layout and hands us its fitView on mount (see
  // onReady), so the view↔edit height animation below can refit each frame as
  // the box resizes. Null until the canvas mounts past the guards.
  const fitViewRef = useRef<(() => void) | null>(null);
  const handleCanvasReady = useCallback((fitView: () => void) => {
    fitViewRef.current = fitView;
  }, []);

  // The available box: the full width of the canvas's wrapper, and the vertical
  // space from the wrapper's top down to the viewport bottom (less BOTTOM_RESERVE).
  // The wrapper top is set by the page chrome above (header + gaps), which never
  // changes with the box height, so measuring it is stable across mode toggles.
  const [avail, setAvail] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const lastAvailRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  // Transition is armed for mode toggles but disarmed for the initial measure
  // and for resizes, so the box tracks the window instantly rather than easing.
  const [animateHeight, setAnimateHeight] = useState(false);
  const wrapElRef = useRef<HTMLDivElement | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  const measure = useCallback(() => {
    const el = wrapElRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = Math.max(0, window.innerHeight - el.getBoundingClientRect().top - bottomReserve());
    const prev = lastAvailRef.current;
    if (Math.abs(w - prev.w) < 0.5 && Math.abs(h - prev.h) < 0.5) return;
    lastAvailRef.current = { w, h };
    setAnimateHeight(false); // a resize commits instantly; only mode toggles ease
    setAvail({ w, h });
  }, []);
  // Callback ref: attach a width observer once the wrapper mounts (it only
  // renders after the loading/empty early-returns below). A ResizeObserver on a
  // full-width element catches layout-width changes; a window 'resize' listener
  // (below) catches viewport-height changes the observer wouldn't see.
  const wrapRef = useCallback(
    (el: HTMLDivElement | null) => {
      resizeObsRef.current?.disconnect();
      wrapElRef.current = el;
      if (!el) {
        resizeObsRef.current = null;
        return;
      }
      measure();
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      resizeObsRef.current = ro;
    },
    [measure],
  );
  useEffect(() => {
    window.addEventListener("resize", measure);
    // Web fonts load after first paint and grow the header a few px, shifting
    // the wrapper's top — a one-time drift neither observer above would catch,
    // and which would otherwise leave the height slightly too tall (a faint
    // scrollbar). Re-measure once fonts settle. (?. short-circuits the whole
    // chain where FontFaceSet is absent, e.g. jsdom.)
    document.fonts?.ready.then(() => measure());
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // The largest box that fits the available rectangle with its aspect ratio
  // clamped to [3:4, 4:3]. When the rectangle's own ratio is already in range we
  // use it whole (no waste — square, 4:3, whatever it is); only a more extreme
  // viewport letterboxes, and then in its long direction so the canvas still
  // fills the short one and never overflows (no vertical scrollbar). Width is
  // shared by both modes so the toggle never shifts the box sideways.
  const dims = useMemo(() => {
    const { w, h } = avail;
    if (w <= 0 || h <= 0) return null;
    const ratio = w / h;
    let width: number;
    let viewH: number;
    if (ratio > MAX_ASPECT) {
      // Wider than 4:3 — fill the height, narrow the width to 4:3.
      viewH = h;
      width = h * MAX_ASPECT;
    } else if (ratio < MIN_ASPECT) {
      // Taller than 3:4 — fill the width, shorten the height to 3:4.
      width = w;
      viewH = w / MIN_ASPECT;
    } else {
      // In range — fill the whole rectangle.
      width = w;
      viewH = h;
    }
    return { width, viewH, editH: viewH * EDIT_HEIGHT_FRACTION };
  }, [avail]);

  // Re-arm the transition one frame after the initial measure or a resize, so
  // the next mode toggle eases but the size change that just committed didn't.
  useEffect(() => {
    if (dims && !animateHeight) {
      const id = requestAnimationFrame(() => setAnimateHeight(true));
      return () => cancelAnimationFrame(id);
    }
  }, [dims, animateHeight]);

  // On a mode toggle, re-fit every frame for the duration of the height
  // transition so the graph zooms to match the shrinking/growing box. The
  // height eases via CSS, so fitting to the current box each frame inherits
  // that easing. Skips the first run (initial mount fits via the sim).
  const firstModeRef = useRef(true);
  // `expanded` is the trigger, not a read value — the effect must re-run each
  // time the mode flips so the fit follows the height transition.
  // biome-ignore lint/correctness/useExhaustiveDependencies: expanded triggers the per-toggle re-fit
  useEffect(() => {
    if (firstModeRef.current) {
      firstModeRef.current = false;
      return;
    }
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now: number) {
      fitViewRef.current?.();
      raf = now - start < MODE_ANIM_MS + 60 ? requestAnimationFrame(tick) : 0;
    });
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [expanded]);

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
  // Node selection (click/tap a circle). Independent of edge selection but
  // mutually exclusive in practice: selecting one clears the other.
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
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
    setSelectedNodeId(null);
  }, [clearPreviewTimer]);
  useEffect(() => clearPreviewTimer, [clearPreviewTimer]);

  const edgeInteraction = useMemo<EdgeInteraction>(
    () => ({ openRelating: onOpenRelating, hoverEdgeId, selectedEdgeId, previewEdge, endPreviewSoon }),
    [onOpenRelating, hoverEdgeId, selectedEdgeId, previewEdge, endPreviewSoon],
  );

  // Shortest-path tree from the center over the (undirected) edge set, rebuilt
  // once per subgraph. Selecting a node walks these parent pointers back to the
  // center to find the chain that should stay lit while the rest dims.
  const parentByNode = useMemo(
    () => (filtered ? shortestPathTree(filtered.edges, filtered.centerId) : new Map<string, string | null>()),
    [filtered],
  );

  // The node ids and edge ids on the selected node's path back to the center.
  // Edge ids are direction-stamped (`relator->relatee`) and we don't know which
  // way the real edge runs, so add both candidates and let set-membership pick
  // the one that exists.
  const { pathNodeIds, pathEdgeIds } = useMemo(
    () => pathToCenter(selectedNodeId, parentByNode),
    [selectedNodeId, parentByNode],
  );

  // A node selection lights its path back to you and dims everything off it; an
  // edge selection just reveals a number, no dimming. So dimming keys off a node
  // being selected, and the lit sets are that node's path (empty otherwise). The
  // canvas applies these to the rendered nodes/edges.
  const dimUnlit = selectedNodeId !== null;

  const empty = !data || data.nodes.length === 0;

  if (isError) {
    return (
      <p role="alert" className="text-base text-destructive">
        Couldn&apos;t load your web.
      </p>
    );
  }
  // !initialReady covers the first-load hold above; isPending covers a genuine
  // empty cache. Errors are checked first so a failed refetch surfaces instead
  // of latching here forever.
  if (isPending || !initialReady) {
    return <p className="text-base text-muted-foreground">Loading your web…</p>;
  }
  if (empty) {
    return (
      <p className="text-base text-muted-foreground">
        No connections yet — start relating to members in Edit mode and they&apos;ll appear here.
      </p>
    );
  }
  // Data is present past the guards above, so the filtered subgraph is too; this
  // narrows the nullable memo for the canvas below.
  if (!filtered) return null;

  // Width is shared by both modes (from `dims`); only the height differs —
  // the full fitted height in view mode, the EDIT_HEIGHT-capped strip in edit
  // mode. Animating just the height keeps the box from shifting sideways on
  // the toggle; the top stays put, so the bottom edge is what travels.
  const heightPx = dims ? (expanded ? dims.viewH : dims.editH) : undefined;

  return (
    // Full-width wrapper: its width is the available width (clientWidth) and
    // its top is the canvas's offset from the viewport top — both read by
    // measure() to size the centered box inside without measuring the box's
    // own (derived) width, which would be circular.
    <div ref={wrapRef} className="w-full">
      <div
        data-tour="graph"
        style={{
          width: dims ? `${dims.width}px` : undefined,
          height: heightPx ? `${heightPx}px` : undefined,
          transition: animateHeight ? `height ${MODE_ANIM_MS}ms ${MODE_ANIM_EASE}` : undefined,
        }}
        className="mx-auto overflow-hidden rounded border border-border bg-canvas [--xy-background-color:var(--color-canvas)]"
      >
        <WebGraphCanvas
          subgraph={filtered}
          litNodeIds={pathNodeIds}
          litEdgeIds={pathEdgeIds}
          dimUnlit={dimUnlit}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          edgeInteraction={edgeInteraction}
          onReady={handleCanvasReady}
          // Hover previews a number on desktop (off while an edge is selected).
          onEdgeMouseEnter={(_event, edge) => previewEdge(edge.id)}
          onEdgeMouseLeave={() => endPreviewSoon()}
          // Click/tap a line selects it and shows its number; a second click on
          // the selected line opens the relating dialog (clicking the number
          // does the same). Tap within the edge's interactionWidth (±5px) on mobile.
          onEdgeClick={(_event, edge) => {
            clearPreviewTimer();
            // Selecting an edge supersedes any node selection.
            setSelectedNodeId(null);
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
          onNodeClick={(_event, node) => {
            // Select the node (re-click toggles off): lights its path back to
            // you and dims the rest. No viewport pan; clears any edge
            // selection. Double-click still opens the member's profile.
            clearPreviewTimer();
            setHoverEdgeId(null);
            setSelectedEdgeId(null);
            setSelectedNodeId((cur) => (cur === node.id ? null : node.id));
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
          {/* Edit/Done in the lower-left corner so the toggle rides with the
           * graph chrome and the page below stays clear for the feed. Same
           * affordance in both modes, different label. The Done button carries
           * the welcome tour's finishing-step anchor (data-tour). */}
          <Panel position="bottom-left" className="flex flex-col items-start gap-2">
            {doneError && (
              <p
                role="alert"
                className="max-w-[16rem] rounded border border-border bg-background/90 p-2 text-sm text-destructive"
              >
                Couldn&apos;t save your update — your relationships are still saved.
              </p>
            )}
            {mode === "edit" ? (
              <Button variant="secondary" data-tour="done-button" disabled={donePending} onClick={onDone}>
                {donePending ? "Saving…" : "Done"}
              </Button>
            ) : (
              <Button onClick={onEdit}>Edit</Button>
            )}
          </Panel>
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
                  <li>Single-click a circle to highlight its path to you.</li>
                  <li>Double-click a circle to open their profile.</li>
                  <li>
                    <span className="font-medium text-foreground">Friends-of-friends</span> adds your connections&apos;
                    connections.
                  </li>
                  <li>
                    Toggle <span className="font-medium text-foreground">1–4</span> to show only those relationship
                    depths.
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
          <WebGraphControls
            hops={view.hops}
            onHopsChange={(hops) => setView((v) => ({ ...v, hops }))}
            valueFilter={valueFilter}
            onToggleValue={toggleValue}
          />
        </WebGraphCanvas>
      </div>
    </div>
  );
}
