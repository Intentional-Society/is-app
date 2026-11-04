import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiClient: {
    api: {
      programs: {
        ":id": {
          "message-box": { $get: vi.fn(), $post: vi.fn() },
        },
      },
      admin: {
        programs: {
          ":id": {
            "message-box": {
              messages: { ":messageId": { $delete: vi.fn() } },
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
const $delete = vi.mocked(apiClient.api.admin.programs[":id"]["message-box"].messages[":messageId"].$delete);

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

  it("lets a moderator delete a message after confirming", async () => {
    mockBox(box({ canModerate: true }));
    $delete.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as never);
    renderBox();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect($delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect($delete).toHaveBeenCalledWith({ param: { id: "p1", messageId: "m1" } }));
  });

  it("backs out of a delete on Cancel", async () => {
    mockBox(box({ canModerate: true }));
    renderBox();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeVisible();
    expect($delete).not.toHaveBeenCalled();
  });

  it("surfaces a load error", async () => {
    $get.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
    renderBox();
    expect(await screen.findByText("Couldn't load the message box.")).toBeVisible();
  });
});
