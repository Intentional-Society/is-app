import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiClient: {
    api: {
      programs: {
        $get: vi.fn(),
        ":id": { join: { $post: vi.fn() }, leave: { $post: vi.fn() } },
      },
    },
  },
}));

import { ProgramsList } from "@/app/programs/programs-list";
import { apiClient } from "@/lib/api";

const $list = vi.mocked(apiClient.api.programs.$get);
const $leave = vi.mocked(apiClient.api.programs[":id"].leave.$post);

const program = (joined: boolean) => ({
  id: "p1",
  slug: "book-club",
  name: "Book Club",
  blurb: null,
  description: null,
  signupsOpen: true,
  memberCount: joined ? 3 : 2,
  memberAvatars: [],
  joined,
  joinedAt: joined ? "2026-01-01T00:00:00.000Z" : null,
});
const listResponse = (joined: boolean) => ({ ok: true, json: async () => ({ programs: [program(joined)] }) }) as never;

describe("ProgramsList leave confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    $list.mockResolvedValue(listResponse(true));
    $leave.mockResolvedValue({ ok: true, json: async () => ({}) } as never);
  });

  it("does not leave on the first click, and Cancel backs out", async () => {
    render(<ProgramsList />);
    fireEvent.click(await screen.findByRole("button", { name: "Leave program" }));
    expect(screen.getByRole("button", { name: "Yes, leave program" })).toBeInTheDocument();
    expect($leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Leave program" })).toBeInTheDocument();
    expect($leave).not.toHaveBeenCalled();
  });

  it("leaves on confirm and holds the card locked until the refetch lands", async () => {
    render(<ProgramsList />);
    fireEvent.click(await screen.findByRole("button", { name: "Leave program" }));

    // Hold the post-leave refetch open to observe the window between the POST
    // returning and fresh data arriving.
    let finishRefetch: (value: never) => void = () => {};
    $list.mockReturnValueOnce(new Promise<never>((resolve) => (finishRefetch = resolve)));
    fireEvent.click(screen.getByRole("button", { name: "Yes, leave program" }));

    await waitFor(() => expect($leave).toHaveBeenCalledWith({ param: { id: "p1" } }));
    expect(await screen.findByRole("button", { name: "Leaving…" })).toBeDisabled();
    // The stale `joined` card must not offer a live Leave button mid-refetch.
    expect(screen.queryByRole("button", { name: "Leave program" })).not.toBeInTheDocument();

    await act(async () => finishRefetch(listResponse(false)));
    expect(await screen.findByRole("button", { name: "Join program" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leaving…" })).not.toBeInTheDocument();
  });

  it("shows the error and returns to the Leave button when leaving fails", async () => {
    $leave.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
    render(<ProgramsList />);
    fireEvent.click(await screen.findByRole("button", { name: "Leave program" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, leave program" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to leave program.");
    expect(await screen.findByRole("button", { name: "Leave program" })).toBeEnabled();
  });
});
