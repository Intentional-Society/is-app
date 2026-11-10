import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiClient: {
    api: {
      admin: {
        programs: {
          ":id": {
            "message-box": {
              archived: { $get: vi.fn() },
              messages: { ":messageId": { $patch: vi.fn(), $delete: vi.fn() } },
            },
          },
        },
      },
    },
  },
}));

import { ArchivedMessages } from "@/app/admin/programs/[id]/message-box-archived";
import { apiClient } from "@/lib/api";

const route = apiClient.api.admin.programs[":id"]["message-box"];
const $list = vi.mocked(route.archived.$get);
const $restore = vi.mocked(route.messages[":messageId"].$patch);
const $delete = vi.mocked(route.messages[":messageId"].$delete);

const archived = (id: string, body: string) => ({
  id,
  body,
  createdAt: "2026-11-01T18:00:00.000Z",
  archivedAt: "2026-11-02T18:00:00.000Z",
  mine: false,
  author: { id: "u1", slug: "ada", displayName: "Ada Lovelace", avatarUrl: null },
});

const mockList = (messages: ReturnType<typeof archived>[]) => {
  $list.mockResolvedValue({ ok: true, json: async () => ({ messages }) } as never);
};

const renderArchived = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ArchivedMessages programId="p1" />
    </QueryClientProvider>,
  );
};

describe("ArchivedMessages (admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the count and each archived message with its author", async () => {
    mockList([archived("a1", "Hidden one"), archived("a2", "Hidden two")]);
    renderArchived();
    expect(await screen.findByText("Archived messages (2)")).toBeInTheDocument();
    expect(screen.getByText("Hidden one")).toBeInTheDocument();
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(2);
  });

  it("says so when nothing is archived", async () => {
    mockList([]);
    renderArchived();
    expect(await screen.findByText("Archived messages (0)")).toBeInTheDocument();
    expect(screen.getByText("No archived messages.")).toBeInTheDocument();
  });

  it("restores a message", async () => {
    mockList([archived("a1", "Hidden one")]);
    $restore.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as never);
    renderArchived();
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect($restore).toHaveBeenCalledWith({
        param: { id: "p1", messageId: "a1" },
        json: { archived: false },
      }),
    );
  });

  it("deletes permanently only after confirming, and backs out on Cancel", async () => {
    mockList([archived("a1", "Hidden one")]);
    $delete.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as never);
    renderArchived();

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect($delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect($delete).toHaveBeenCalledWith({ param: { id: "p1", messageId: "a1" } }));
  });

  it("shows the error when a restore fails", async () => {
    mockList([archived("a1", "Hidden one")]);
    $restore.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
    renderArchived();
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't restore the message.");
  });

  it("surfaces a load error", async () => {
    $list.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
    renderArchived();
    expect(await screen.findByText("Couldn't load archived messages.")).toBeInTheDocument();
  });
});
