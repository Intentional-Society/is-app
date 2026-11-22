import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
