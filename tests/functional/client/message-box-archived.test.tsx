import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  describe("Delete waits out a 30-second Undo window", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const confirmDelete = async () => {
      mockList([archived("a1", "Hidden one"), archived("a2", "Hidden two")]);
      $delete.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as never);
      renderArchived();
      fireEvent.click((await screen.findAllByRole("button", { name: "Delete" }))[0]);
      fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    };

    it("asks for confirmation, and Cancel backs out", async () => {
      mockList([archived("a1", "Hidden one")]);
      renderArchived();
      fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByText("Hidden one")).toBeInTheDocument();
      expect($delete).not.toHaveBeenCalled();
    });

    it("hides the row at once with an Undo notice, and deletes only after 30 seconds", async () => {
      await confirmDelete();
      expect(await screen.findByText("Deleting Ada Lovelace's message.")).toBeInTheDocument();
      expect(screen.queryByText("Hidden one")).not.toBeInTheDocument();
      expect(screen.getByText("Hidden two")).toBeInTheDocument();
      expect(screen.getByText("Archived messages (1)")).toBeInTheDocument();
      expect($delete).not.toHaveBeenCalled();

      await act(() => vi.advanceTimersByTimeAsync(29_000));
      expect($delete).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(2_000));
      await waitFor(() => expect($delete).toHaveBeenCalledWith({ param: { id: "p1", messageId: "a1" } }));
      expect($delete).toHaveBeenCalledTimes(1);
    });

    it("Undo brings the row back and never deletes it", async () => {
      await confirmDelete();
      fireEvent.click(await screen.findByRole("button", { name: /Undo \(\d+s\)/ }));
      expect(await screen.findByText("Hidden one")).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect($delete).not.toHaveBeenCalled();
    });

    it("shows the error and brings the row back if the delete fails", async () => {
      mockList([archived("a1", "Hidden one")]);
      $delete.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
      renderArchived();
      fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
      await act(() => vi.advanceTimersByTimeAsync(31_000));
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete the message.");
      expect(await screen.findByText("Hidden one")).toBeInTheDocument();
    });
  });

  it("shows the error when a restore fails", async () => {
    mockList([archived("a1", "Hidden one")]);
    $restore.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
    renderArchived();
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't restore the message.");
  });

  it("explains a restore that fails because the message is gone, and refreshes the list", async () => {
    mockList([archived("a1", "Hidden one")]);
    $restore.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "not_found" }) } as never);
    renderArchived();
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That message is no longer available");
    // Loaded once on mount, once more after the failure.
    await waitFor(() => expect($list).toHaveBeenCalledTimes(2));
  });

  it("shows nothing, not an error, when the viewer isn't allowed the archive (a 404)", async () => {
    $list.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "not_found" }) } as never);
    renderArchived();
    await waitFor(() => expect($list).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByText(/Archived messages/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    $list.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
    renderArchived();
    expect(await screen.findByText("Couldn't load archived messages.")).toBeInTheDocument();
  });
});
