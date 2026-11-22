import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiClient: {
    api: {
      programs: {
        "by-slug": { ":slug": { $get: vi.fn() } },
        ":id": { join: { $post: vi.fn() }, leave: { $post: vi.fn() } },
      },
    },
  },
}));

import { ProgramSlugDetail } from "@/app/programs/[slug]/program-slug-detail";
import { programQueryKey } from "@/app/programs/[slug]/query-keys";
import { apiClient } from "@/lib/api";

const $get = vi.mocked(apiClient.api.programs["by-slug"][":slug"].$get);
const $leave = vi.mocked(apiClient.api.programs[":id"].leave.$post);

const program = (joined: boolean) => ({
  id: "p1",
  slug: "book-club",
  name: "Book Club",
  blurb: null,
  description: null,
  signupsOpen: true,
  memberCount: 3,
  joined,
  joinedAt: joined ? "2026-01-01T00:00:00.000Z" : null,
  members: [],
});
const getResponse = (joined: boolean) =>
  ({ ok: true, status: 200, json: async () => ({ program: program(joined) }) }) as never;

const renderDetail = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(programQueryKey("book-club"), program(true));
  return render(
    <QueryClientProvider client={queryClient}>
      <ProgramSlugDetail slug="book-club" />
    </QueryClientProvider>,
  );
};

describe("ProgramSlugDetail leave confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    $leave.mockResolvedValue({ ok: true, json: async () => ({}) } as never);
  });

  it("does not leave on the first click, and Cancel backs out", () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    expect(screen.getByRole("button", { name: "Yes, leave program" })).toBeInTheDocument();
    expect($leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Leave program" })).toBeInTheDocument();
    expect($leave).not.toHaveBeenCalled();
  });

  it("leaves on confirm and stays locked until the refetch lands", async () => {
    renderDetail();
    let finishRefetch: (value: never) => void = () => {};
    $get.mockReturnValueOnce(new Promise<never>((resolve) => (finishRefetch = resolve)));
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, leave program" }));

    await waitFor(() => expect($leave).toHaveBeenCalledWith({ param: { id: "p1" } }));
    expect(await screen.findByRole("button", { name: "Leaving…" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "Leave program" })).not.toBeInTheDocument();

    await act(async () => finishRefetch(getResponse(false)));
    expect(await screen.findByRole("button", { name: "Join program" })).toBeInTheDocument();
  });

  it("shows the error and returns to the Leave button when leaving fails", async () => {
    $leave.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, leave program" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to leave program.");
    expect(await screen.findByRole("button", { name: "Leave program" })).toBeEnabled();
  });
});
