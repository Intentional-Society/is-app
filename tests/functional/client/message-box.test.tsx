import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiClient: {
    api: {
      programs: {
        ":id": {
          "message-box": {
            $get: vi.fn(),
            $post: vi.fn(),
            messages: { ":messageId": { $patch: vi.fn() } },
          },
        },
      },
      admin: {
        programs: {
          ":id": {
            "message-box": {
              messages: { ":messageId": { $delete: vi.fn(), $patch: vi.fn() } },
            },
          },
        },
      },
    },
  },
}));

import { MessageBox } from "@/app/programs/[slug]/message-box";
import { apiClient } from "@/lib/api";
import type { MessageBoxResponse } from "@/lib/api-types";

const $get = vi.mocked(apiClient.api.programs[":id"]["message-box"].$get);
const $post = vi.mocked(apiClient.api.programs[":id"]["message-box"].$post);
const $patch = vi.mocked(apiClient.api.programs[":id"]["message-box"].messages[":messageId"].$patch);
const $delete = vi.mocked(apiClient.api.admin.programs[":id"]["message-box"].messages[":messageId"].$delete);
const $archive = vi.mocked(apiClient.api.admin.programs[":id"]["message-box"].messages[":messageId"].$patch);

const box = (overrides: Partial<MessageBoxResponse> = {}): MessageBoxResponse => ({
  visibility: "members",
  prompt: null,
  canRead: true,
  canPost: true,
  canModerate: false,
  messages: [
    {
      id: "m1",
      body: "Sending love from afar",
      createdAt: "2026-11-01T18:00:00.000Z",
      mine: false,
      author: { id: "u1", slug: "ada", displayName: "Ada Lovelace", avatarUrl: null },
    },
  ],
  ...overrides,
});

const mockBox = (value: MessageBoxResponse) => {
  $get.mockResolvedValue({ ok: true, json: async () => value } as never);
};

const renderBox = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MessageBox programId="p1" />
    </QueryClientProvider>,
  );
};

describe("MessageBox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the form and the messages with their authors to a participant", async () => {
    mockBox(box());
    renderBox();
    expect(await screen.findByText("Sending love from afar")).toBeVisible();
    expect(screen.getByRole("link", { name: "Ada Lovelace" })).toHaveAttribute("href", "/members/ada");
    expect(screen.getByLabelText("Leave a message")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("asks a non-participant to join instead of showing the form", async () => {
    mockBox(box({ canPost: false }));
    renderBox();
    expect(await screen.findByText("Join this program to leave a message.")).toBeVisible();
    expect(screen.queryByLabelText("Leave a message")).not.toBeInTheDocument();
    expect(screen.getByText("Sending love from afar")).toBeVisible();
  });

  it("explains that messages are admin-read when the viewer can't read them", async () => {
    mockBox(box({ visibility: "admins", canRead: false, messages: [] }));
    renderBox();
    expect(await screen.findByText("Messages sent here are read by the program's admins.")).toBeVisible();
    expect(screen.getByLabelText("Leave a message")).toBeVisible();
  });

  it("shows the program's prompt above the form", async () => {
    mockBox(box({ prompt: "Won't be there at the next call? **Send a note.**" }));
    renderBox();
    expect(await screen.findByText(/Won't be there at the next call\?/)).toBeVisible();
    expect(screen.getByText("Send a note.").tagName).toBe("STRONG");
  });

  it("shows no prompt block when none is set", async () => {
    mockBox(box());
    renderBox();
    await screen.findByText("Sending love from afar");
    expect(screen.queryByText(/next call/)).not.toBeInTheDocument();
  });

  it("says so when there are no messages yet", async () => {
    mockBox(box({ messages: [] }));
    renderBox();
    expect(await screen.findByText("No messages yet.")).toBeVisible();
  });

  it("keeps Send disabled until there is text, then posts the trimmed message and clears the field", async () => {
    mockBox(box());
    $post.mockResolvedValue({ ok: true, json: async () => ({ id: "m2" }) } as never);
    renderBox();
    const textarea = await screen.findByLabelText("Leave a message");
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "  Thinking of you all  " } });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    await waitFor(() =>
      expect($post).toHaveBeenCalledWith({ param: { id: "p1" }, json: { body: "Thinking of you all" } }),
    );
    expect(await screen.findByText("Message sent.")).toBeVisible();
    expect(textarea).toHaveValue("");
  });

  it("shows the server's error and keeps the text when posting fails", async () => {
    mockBox(box());
    $post.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "not_participant" }) } as never);
    renderBox();
    const textarea = await screen.findByLabelText("Leave a message");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only participants of this program can leave a message.",
    );
    expect(textarea).toHaveValue("hello");
  });

  describe("moderation (Archive and Delete, each with Undo)", () => {
    const moderator = () => mockBox(box({ canModerate: true }));
    const ok = () => ({ ok: true, json: async () => ({ ok: true }) }) as never;

    beforeEach(() => {
      $archive.mockResolvedValue(ok());
      $delete.mockResolvedValue(ok());
    });

    it("shows Archive only to moderators", async () => {
      mockBox(box());
      const { unmount } = renderBox();
      await screen.findByText("Sending love from afar");
      expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
      unmount();

      moderator();
      renderBox();
      expect(await screen.findByRole("button", { name: "Archive" })).toBeVisible();
    });

    it("asks for confirmation before archiving, and backs out on Cancel", async () => {
      moderator();
      renderBox();
      fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
      expect(screen.getByRole("button", { name: "Confirm archive" })).toBeVisible();
      expect($archive).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("button", { name: "Archive" })).toBeVisible();
      expect($archive).not.toHaveBeenCalled();
    });

    it("archives after confirming, and an Undo notice restores the message", async () => {
      moderator();
      renderBox();
      fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
      await waitFor(() =>
        expect($archive).toHaveBeenCalledWith({ param: { id: "p1", messageId: "m1" }, json: { archived: true } }),
      );
      expect(await screen.findByText("Archived Ada Lovelace's message.")).toBeVisible();
      expect($delete).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: /Undo \(\d+s\)/ }));
      await waitFor(() =>
        expect($archive).toHaveBeenLastCalledWith({ param: { id: "p1", messageId: "m1" }, json: { archived: false } }),
      );
      await waitFor(() => expect(screen.queryByText("Archived Ada Lovelace's message.")).not.toBeInTheDocument());
    });

    it("shows the error and no Undo notice when archiving fails", async () => {
      moderator();
      $archive.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
      renderBox();
      fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't archive the message.");
      expect(screen.queryByRole("button", { name: /Undo/ })).not.toBeInTheDocument();
      expect(screen.getByText("Sending love from afar")).toBeVisible();
    });

    it("keeps an Undo that is still counting down when a refetch fails", async () => {
      moderator();
      renderBox();
      fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
      // The refetch after the archive fails; the last good list must stay on screen.
      $get.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
      fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
      expect(await screen.findByText("Archived Ada Lovelace's message.")).toBeVisible();
      await waitFor(() => expect($get).toHaveBeenCalledTimes(2));
      expect(screen.getByRole("button", { name: /Undo \(\d+s\)/ })).toBeVisible();
      expect(screen.queryByText("Couldn't load the message box.")).not.toBeInTheDocument();
    });

    it("clears an old Undo error when the next moderation action starts", async () => {
      moderator();
      renderBox();
      fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
      await screen.findByText("Archived Ada Lovelace's message.");

      // Undo fails: the restore request is rejected.
      $archive.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as never);
      fireEvent.click(screen.getByRole("button", { name: /Undo \(\d+s\)/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't restore the message.");

      // A fresh archive wipes it.
      fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
      await screen.findByText("Archived Ada Lovelace's message.");
      expect(screen.queryByText("Couldn't restore the message.")).not.toBeInTheDocument();
    });

    it("backs out of a delete on Cancel", async () => {
      moderator();
      renderBox();
      fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("button", { name: "Delete" })).toBeVisible();
      expect($delete).not.toHaveBeenCalled();
      expect($archive).not.toHaveBeenCalled();
    });

    describe("Delete waits out the Undo window", () => {
      beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      const startDelete = async () => {
        moderator();
        renderBox();
        fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
        fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
        // Hidden first (archived), not deleted yet.
        await waitFor(() =>
          expect($archive).toHaveBeenCalledWith({ param: { id: "p1", messageId: "m1" }, json: { archived: true } }),
        );
        expect(await screen.findByText("Deleting Ada Lovelace's message.")).toBeVisible();
        expect($delete).not.toHaveBeenCalled();
      };

      it("deletes for good after 30 seconds", async () => {
        await startDelete();
        await act(() => vi.advanceTimersByTimeAsync(29_000));
        expect($delete).not.toHaveBeenCalled();
        await act(() => vi.advanceTimersByTimeAsync(2_000));
        await waitFor(() => expect($delete).toHaveBeenCalledWith({ param: { id: "p1", messageId: "m1" } }));
        expect($delete).toHaveBeenCalledTimes(1);
      });

      it("Undo within the window restores the message and never deletes it", async () => {
        await startDelete();
        fireEvent.click(screen.getByRole("button", { name: /Undo \(\d+s\)/ }));
        await waitFor(() =>
          expect($archive).toHaveBeenLastCalledWith({
            param: { id: "p1", messageId: "m1" },
            json: { archived: false },
          }),
        );
        await act(() => vi.advanceTimersByTimeAsync(60_000));
        expect($delete).not.toHaveBeenCalled();
      });

      it("leaving the page while the archive request is still in flight starts no delete timer", async () => {
        moderator();
        let finishArchive: (value: unknown) => void = () => {};
        $archive.mockReturnValue(new Promise((resolve) => (finishArchive = resolve)) as never);
        renderBox();
        fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
        fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
        await waitFor(() => expect($archive).toHaveBeenCalledTimes(1));

        cleanup();
        // The slow PATCH completes only after the admin has left.
        await act(async () => finishArchive(ok()));
        await act(() => vi.advanceTimersByTimeAsync(60_000));
        expect($delete).not.toHaveBeenCalled();
      });

      it("leaving the page inside the window leaves the message archived, not deleted", async () => {
        await startDelete();
        cleanup();
        await act(() => vi.advanceTimersByTimeAsync(60_000));
        expect($delete).not.toHaveBeenCalled();
      });
    });
  });

  describe("editing your own message", () => {
    const mine = (overrides: Partial<MessageBoxResponse["messages"][number]> = {}) => ({
      ...box().messages[0],
      id: "m-mine",
      body: "My first draft",
      mine: true,
      ...overrides,
    });

    it("offers Edit only on the viewer's own messages", async () => {
      mockBox(box({ messages: [mine(), box().messages[0]] }));
      renderBox();
      await screen.findByText("My first draft");
      expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    });

    it("offers no Edit to someone who can't post, even on their own message", async () => {
      mockBox(box({ canPost: false, messages: [mine()] }));
      renderBox();
      await screen.findByText("My first draft");
      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    });

    it("saves the trimmed text and closes the editor", async () => {
      mockBox(box({ messages: [mine()] }));
      $patch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as never);
      renderBox();
      fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

      const textarea = screen.getByLabelText("Edit your message");
      expect(textarea).toHaveValue("My first draft");
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

      fireEvent.change(textarea, { target: { value: "  My better draft  " } });
      mockBox(box({ messages: [mine({ body: "My better draft" })] }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect($patch).toHaveBeenCalledWith({
          param: { id: "p1", messageId: "m-mine" },
          json: { body: "My better draft" },
        }),
      );
      expect(await screen.findByText("My better draft")).toBeVisible();
      expect(screen.queryByLabelText("Edit your message")).not.toBeInTheDocument();
    });

    it("explains a save that fails because the message was archived meanwhile, and refreshes the box", async () => {
      mockBox(box({ messages: [mine()] }));
      $patch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "not_found" }) } as never);
      renderBox();
      fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText("Edit your message"), { target: { value: "too late" } });
      mockBox(box({ messages: [] }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect($get).toHaveBeenCalledTimes(2));
      // The box refetched, so the archived message dropped out of the list.
      expect(await screen.findByText("No messages yet.")).toBeVisible();
    });

    it("leaves the message alone on Cancel", async () => {
      mockBox(box({ messages: [mine()] }));
      renderBox();
      fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText("Edit your message"), { target: { value: "changed my mind" } });
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByText("My first draft")).toBeVisible();
      expect($patch).not.toHaveBeenCalled();
    });

    it("keeps the editor open and shows the error when saving fails", async () => {
      mockBox(box({ messages: [mine()] }));
      $patch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "not_participant" }) } as never);
      renderBox();
      fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText("Edit your message"), { target: { value: "new text" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Only participants of this program can leave a message.",
      );
      expect(screen.getByLabelText("Edit your message")).toHaveValue("new text");
    });
  });

  it("surfaces a load error", async () => {
    $get.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
    renderBox();
    expect(await screen.findByText("Couldn't load the message box.")).toBeVisible();
  });
});
