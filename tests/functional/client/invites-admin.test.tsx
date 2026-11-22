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
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete this invite");
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
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete this invite");
  });
  it("keeps one row's failure message when a different row is deleted, and clears it on retry", async () => {
    const second = { ...invite, id: "i2", note: "For Linus", code: "def456" };
    $list.mockResolvedValue({ ok: true, json: async () => ({ invites: [invite, second] }) } as never);
    $delete.mockImplementation((({ param }: { param: { id: string } }) =>
      Promise.resolve(
        param.id === "i1" ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, json: async () => ({}) },
      )) as never);
    renderAdmin();
    const row = (note: string) => within(screen.getByText(note).closest("li") as HTMLElement);
    await screen.findByText("For Ada");

    fireEvent.click(row("For Ada").getByRole("button", { name: "Delete" }));
    fireEvent.click(row("For Ada").getByRole("button", { name: "Confirm" }));
    expect(await row("For Ada").findByRole("alert")).toHaveTextContent("Couldn't delete this invite");
    expect(row("For Linus").queryByRole("alert")).not.toBeInTheDocument();

    // Deleting another invite does not wipe the failed row's message.
    fireEvent.click(row("For Linus").getByRole("button", { name: "Delete" }));
    fireEvent.click(row("For Linus").getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect($delete).toHaveBeenCalledTimes(2));
    expect(row("For Ada").getByRole("alert")).toBeInTheDocument();

    // Retrying the failed invite clears its message while the request runs.
    $delete.mockReturnValue(new Promise(() => {}) as never);
    fireEvent.click(row("For Ada").getByRole("button", { name: "Delete" }));
    fireEvent.click(row("For Ada").getByRole("button", { name: "Confirm" }));
    expect(row("For Ada").queryByRole("alert")).not.toBeInTheDocument();
  });
  it("refetches after a failed delete, so a stale row goes away instead of asking for a retry", async () => {
    $delete.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as never);
    renderAdmin();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    // Another admin already deleted it, so the refetch no longer includes it.
    $list.mockResolvedValue({ ok: true, json: async () => ({ invites: [] }) } as never);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("No invites yet.")).toBeInTheDocument();
    expect($list).toHaveBeenCalledTimes(2);
  });
  it("keeps the list and the row's failure message when the refetch after a failed delete also fails", async () => {
    $delete.mockRejectedValue(new Error("network down"));
    renderAdmin();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    $list.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as never);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete this invite");
    await waitFor(() => expect($list).toHaveBeenCalledTimes(2));
    expect(screen.getByText("For Ada")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load invites.")).not.toBeInTheDocument();
  });

  it("does not make a failed delete wait for the refetch", async () => {
    $delete.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
    renderAdmin();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    $list.mockReturnValue(new Promise(() => {}) as never); // the refetch never returns
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete this invite");
    expect(await screen.findByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("shows a load error when the first load fails", async () => {
    $list.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
    renderAdmin();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load invites.");
  });
});
