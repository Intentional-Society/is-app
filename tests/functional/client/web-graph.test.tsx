import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ReactFlow measures its container via ResizeObserver, which jsdom lacks; the
// component also instantiates one directly. A no-op stub lets the graph mount so
// we can reach the in-canvas controls.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// The d3-force simulation runs a timer and mutates positions — none of which
// this component-level suite asserts on (the layout math is unit-tested
// separately). Stub the module to an inert chainable so building the sim is a
// no-op: no ticks, no leaked timers.
vi.mock("d3-force", () => {
  const chain: Record<string, unknown> = new Proxy({}, { get: () => () => chain });
  return {
    forceSimulation: () => chain,
    forceManyBody: () => chain,
    forceLink: () => chain,
    forceCollide: () => chain,
  };
});

// Stand in for the canvas renderer: render the children (Controls, Panels, the
// hops checkbox) so we can drive the surrounding wiring without ReactFlow's DOM
// measurement. Node/edge rendering is out of scope here — that's the unit suites
// (selection/layout) plus e2e.
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children?: ReactNode }) => <div data-testid="reactflow">{children}</div>,
  Panel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Controls: () => null,
  Handle: () => null,
  BaseEdge: () => null,
  EdgeLabelRenderer: ({ children }: { children?: ReactNode }) => <>{children}</>,
  getStraightPath: () => ["", 0, 0],
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/lib/api", () => ({
  apiClient: { api: { relations: { subgraph: { $get: vi.fn() } } } },
}));

import { VIEW_STORAGE_KEY } from "@/app/myweb/query-keys";
import { WebGraph } from "@/app/myweb/web-graph";
import { apiClient } from "@/lib/api";

const $get = vi.mocked(apiClient.api.relations.subgraph.$get);

const node = (id: string, displayName: string) => ({ id, slug: id, displayName, avatarUrl: null });
const okResponse = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as never;

const emptyWeb = { centerId: "c", nodes: [], edges: [] };
const populatedWeb = {
  centerId: "c",
  nodes: [node("c", "Center"), node("a", "Ada")],
  edges: [{ relatorId: "c", relateeId: "a", value: 3 }],
};

const renderGraph = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebGraph square={false} onOpenRelating={vi.fn()} onReplayTour={vi.fn()} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("WebGraph — data states", () => {
  it("shows a loading message while the subgraph is pending", () => {
    $get.mockReturnValue(new Promise(() => {}) as never); // never resolves
    renderGraph();
    expect(screen.getByText("Loading your web…")).toBeVisible();
  });

  it("shows an error alert when the subgraph request fails", async () => {
    $get.mockResolvedValue({ ok: false, status: 500 } as never);
    renderGraph();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your web.");
  });

  it("shows an empty-state hint when there are no connections", async () => {
    $get.mockResolvedValue(okResponse(emptyWeb));
    renderGraph();
    expect(await screen.findByText(/No connections yet/)).toBeVisible();
  });
});

describe("WebGraph — view persistence", () => {
  it("writes the current view to localStorage on mount", async () => {
    $get.mockResolvedValue(okResponse(emptyWeb));
    renderGraph();
    await waitFor(() => expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe(JSON.stringify({ hops: 2 })));
  });

  it("restores a stored non-default view and fetches with it", async () => {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ hops: 1 }));
    $get.mockResolvedValue(okResponse(emptyWeb));
    renderGraph();
    await waitFor(() => expect($get).toHaveBeenCalledWith({ query: { hops: "1" } }));
  });
});

describe("WebGraph — hops toggle", () => {
  it("reflects the current view and refetches + persists when toggled", async () => {
    $get.mockResolvedValue(okResponse(populatedWeb));
    renderGraph();

    const toggle = await screen.findByRole("checkbox", { name: "2 hops" });
    expect(toggle).toBeChecked(); // default view is 2 hops
    await waitFor(() => expect($get).toHaveBeenCalledWith({ query: { hops: "2" } }));

    fireEvent.click(toggle); // → 1 hop

    await waitFor(() => expect($get).toHaveBeenCalledWith({ query: { hops: "1" } }));
    await waitFor(() => expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe(JSON.stringify({ hops: 1 })));
    expect(toggle).not.toBeChecked();
  });
});
