import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiClient: {
    api: {
      admin: {
        invites: {
          $get: vi.fn(),
          ":id": { $delete: vi.fn() },
        },
      },
    },
  },
}));

import { InvitesAdmin } from "@/app/admin/invites/invites-admin";
import { apiClient } from "@/lib/api";

const $list = vi.mocked(apiClient.api.admin.invites.$get);
const $delete = vi.mocked(apiClient.api.admin.invites[":id"].$delete);

const invite = {
  id: "i1",
  note: "For Ada",
  code: "abc123",
  status: "open",
  createdAt: "2026-11-01T18:00:00.000Z",
  creatorName: "Grace",
  redeemerName: null,
};

const renderAdmin = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <InvitesAdmin />
    </QueryClientProvider>,
  );
};

describe("InvitesAdmin delete confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    $list.mockResolvedValue({ ok: true, json: async () => ({ invites: [invite] }) } as never);
  });

  it("does not delete on the first click", async () => {
    renderAdmin();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect($delete).not.toHaveBeenCalled();
  });

  it("deletes the invite on confirm", async () => {
    $delete.mockResolvedValue({ ok: true, json: async () => ({}) } as never);
    renderAdmin();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect($delete).toHaveBeenCalledWith({ param: { id: "i1" } }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tells the admin when the delete fails, instead of silently resetting the row", async () => {
    $delete.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
    renderAdmin();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete the invite");
    expect(await screen.findByRole("button", { name: "Delete" })).toBeEnabled();
  });
  it("reports a row's failure even when another row's delete started after it and succeeded", async () => {
    const second = { ...invite, id: "i2", note: "For Linus", code: "def456" };
    $list.mockResolvedValue({ ok: true, json: async () => ({ invites: [invite, second] }) } as never);
    let failFirst: (value: never) => void = () => {};
    $delete.mockImplementation((({ param }: { param: { id: string } }) =>
      param.id === "i1"
        ? new Promise<never>((resolve) => (failFirst = resolve))
        : Promise.resolve({ ok: true, json: async () => ({}) })) as never);
    renderAdmin();
    const row = (note: string) => within(screen.getByText(note).closest("li") as HTMLElement);
    await screen.findByText("For Ada");

    fireEvent.click(row("For Ada").getByRole("button", { name: "Delete" }));
    fireEvent.click(row("For Ada").getByRole("button", { name: "Confirm" }));
    fireEvent.click(row("For Linus").getByRole("button", { name: "Delete" }));
    fireEvent.click(row("For Linus").getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect($delete).toHaveBeenCalledTimes(2));

    // The first row's request fails after the second one started (and succeeded).
    await act(async () => failFirst({ ok: false, status: 500, json: async () => ({}) } as never));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete the invite");
  });
});
