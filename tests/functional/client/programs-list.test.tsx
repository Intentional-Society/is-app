import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const $join = vi.mocked(apiClient.api.programs[":id"].join.$post);

const program = (joined: boolean, id = "p1", name = "Book Club") => ({
  id,
  slug: id,
  name,
  blurb: null,
  description: null,
  signupsOpen: true,
  memberCount: joined ? 3 : 2,
  memberAvatars: [],
  joined,
  joinedAt: joined ? "2026-01-01T00:00:00.000Z" : null,
});
const listOf = (...programs: ReturnType<typeof program>[]) => ({ ok: true, json: async () => ({ programs }) }) as never;
const listResponse = (joined: boolean) => listOf(program(joined));

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
  it("ignores a slower, older refetch that lands after a newer one", async () => {
    $list.mockResolvedValue(listOf(program(true, "p1", "Book Club"), program(false, "p2", "Garden Club")));
    $join.mockResolvedValue({ ok: true, json: async () => ({}) } as never);
    render(<ProgramsList />);
    const card = (name: string) => within(screen.getByRole("heading", { name }).closest("li") as HTMLElement);
    await screen.findByRole("heading", { name: "Book Club" });

    // Leave Book Club, then join Garden Club before the first refetch returns.
    let finishOlder: (value: never) => void = () => {};
    let finishNewer: (value: never) => void = () => {};
    $list.mockReturnValueOnce(new Promise<never>((resolve) => (finishOlder = resolve)));
    $list.mockReturnValueOnce(new Promise<never>((resolve) => (finishNewer = resolve)));
    fireEvent.click(card("Book Club").getByRole("button", { name: "Leave program" }));
    fireEvent.click(card("Book Club").getByRole("button", { name: "Yes, leave program" }));
    await waitFor(() => expect($leave).toHaveBeenCalled());
    fireEvent.click(card("Garden Club").getByRole("button", { name: "Join program" }));
    await waitFor(() => expect($join).toHaveBeenCalled());

    // The newer refetch (both changes applied) lands first; the older one, a
    // snapshot from before Garden Club was joined, lands last.
    await act(async () => finishNewer(listOf(program(false, "p1", "Book Club"), program(true, "p2", "Garden Club"))));
    await act(async () => finishOlder(listOf(program(false, "p1", "Book Club"), program(false, "p2", "Garden Club"))));

    expect(card("Garden Club").getByRole("button", { name: "Leave program" })).toBeInTheDocument();
    expect(card("Garden Club").queryByRole("button", { name: "Join program" })).not.toBeInTheDocument();
  });
});
