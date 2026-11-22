import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiClient: {
    api: {
      admin: {
        "buttondown-sync": {
          "dry-run": { $post: vi.fn() },
          write: { $post: vi.fn() },
        },
      },
    },
  },
}));

import { ButtondownSyncButtons } from "@/app/admin/buttondown-sync-buttons";
import { apiClient } from "@/lib/api";

const $dryRun = vi.mocked(apiClient.api.admin["buttondown-sync"]["dry-run"].$post);
const $write = vi.mocked(apiClient.api.admin["buttondown-sync"].write.$post);
const okSummary = { ok: true, json: async () => ({ status: "ok", summary: { patched: 0 } }) } as never;

describe("ButtondownSyncButtons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    $dryRun.mockResolvedValue(okSummary);
    $write.mockResolvedValue(okSummary);
  });

  it("runs the dry run on one click, with no confirm step", async () => {
    render(<ButtondownSyncButtons />);
    fireEvent.click(screen.getByRole("button", { name: "Sync Buttondown (dry run)" }));
    await waitFor(() => expect($dryRun).toHaveBeenCalledTimes(1));
    expect($write).not.toHaveBeenCalled();
  });

  it("does not write on the first click, and Cancel backs out", () => {
    render(<ButtondownSyncButtons />);
    fireEvent.click(screen.getByRole("button", { name: "Sync Buttondown (write)" }));
    expect(screen.getByRole("button", { name: "Yes, write to Buttondown" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Sync Buttondown (write)" })).toBeInTheDocument();
    expect($write).not.toHaveBeenCalled();
  });

  it("writes only after the confirm click, and shows the result", async () => {
    render(<ButtondownSyncButtons />);
    fireEvent.click(screen.getByRole("button", { name: "Sync Buttondown (write)" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, write to Buttondown" }));
    await waitFor(() => expect($write).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/"patched": 0/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Sync Buttondown (write)" })).toBeInTheDocument();
  });

  it("shows the error and resets the button when the write fails", async () => {
    $write.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
    render(<ButtondownSyncButtons />);
    fireEvent.click(screen.getByRole("button", { name: "Sync Buttondown (write)" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, write to Buttondown" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sync failed: status 500");
    expect(await screen.findByRole("button", { name: "Sync Buttondown (write)" })).toBeInTheDocument();
  });
});
