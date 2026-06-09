import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Same shims as web-graph.test.tsx: jsdom lacks ResizeObserver, and the d3-force
// sim + ReactFlow DOM measurement aren't what this suite asserts — it covers the
// mini-map's own loading/error/render states. The real canvas render is e2e.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("d3-force", () => {
  const chain: Record<string, unknown> = new Proxy({}, { get: () => () => chain });
  return {
    forceSimulation: () => chain,
    forceManyBody: () => chain,
    forceLink: () => chain,
    forceCollide: () => chain,
  };
});

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
  apiClient: { api: { relations: { "mini-map": { ":profileId": { $get: vi.fn() } } } } },
}));

import { ProfileMiniMap } from "@/app/members/[id]/profile-mini-map";
import { apiClient } from "@/lib/api";

const $get = vi.mocked(apiClient.api.relations["mini-map"][":profileId"].$get);

const node = (id: string, displayName: string) => ({ id, slug: id, displayName, avatarUrl: null });
const okResponse = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as never;

const withPath = {
  emphasizedId: "them",
  viewerId: "me",
  nodes: [node("them", "Them"), node("x", "X"), node("me", "Me")],
  edges: [
    { relatorId: "them", relateeId: "x", value: 4 },
    { relatorId: "x", relateeId: "me", value: 3 },
  ],
  pathToViewer: ["them", "x", "me"],
};

const justThem = {
  emphasizedId: "them",
  viewerId: "me",
  nodes: [node("them", "Them")],
  edges: [],
  pathToViewer: [],
};

const renderMiniMap = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfileMiniMap profileId="them" memberName="Them" />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProfileMiniMap", () => {
  it("shows a loading message while the map is pending", () => {
    $get.mockReturnValue(new Promise(() => {}) as never); // never resolves
    renderMiniMap();
    expect(screen.getByText("Loading map…")).toBeVisible();
  });

  it("shows an error alert when the request fails", async () => {
    $get.mockResolvedValue({ ok: false, status: 500 } as never);
    renderMiniMap();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the map.");
  });

  it("mounts the canvas once the map loads", async () => {
    $get.mockResolvedValue(okResponse(withPath));
    renderMiniMap();
    expect(await screen.findByTestId("reactflow")).toBeInTheDocument();
    expect(screen.queryByText("Loading map…")).not.toBeInTheDocument();
  });

  it("renders the canvas for a member with no path to the viewer", async () => {
    $get.mockResolvedValue(okResponse(justThem));
    renderMiniMap();
    expect(await screen.findByTestId("reactflow")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
