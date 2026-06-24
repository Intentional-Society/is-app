import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiClient: {
    api: {
      relations: {
        value: {
          ":relateeId": {
            $put: vi.fn(),
            $delete: vi.fn(),
          },
        },
      },
    },
  },
}));

import { RelatingDialog, type RelatingTarget } from "@/app/myweb/relating-dialog";
import { apiClient } from "@/lib/api";

const $delete = vi.mocked(apiClient.api.relations.value[":relateeId"].$delete);

const renderDialog = (target: RelatingTarget | null, onClose = vi.fn()) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RelatingDialog target={target} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
};

describe("RelatingDialog — No Relationship option", () => {
  it("offers the No Relationship option when a relationship already exists", async () => {
    renderDialog({ id: "m1", displayName: "Ada", currentValue: 3 });

    expect(await screen.findByRole("button", { name: /No Relationship/ })).toBeVisible();
  });

  it("hides the No Relationship option for a fresh suggestion with no relationship", async () => {
    renderDialog({ id: "m1", displayName: "Ada" });

    // The 1–4 buttons render, but there's nothing to remove.
    expect(await screen.findByRole("button", { name: /Acquaintance/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /No Relationship/ })).toBeNull();
  });

  it("shows the member's avatar in the header (#420)", () => {
    // No photo set → the Avatar falls back to initials, distinct from the
    // "Who is Bao Tran to you?" title text.
    renderDialog({ id: "m1", displayName: "Bao Tran" });
    expect(screen.getByText("BT")).toBeVisible();
  });

  it("removes via DELETE and closes the dialog on success", async () => {
    $delete.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as never);
    const { onClose } = renderDialog({ id: "m1", displayName: "Ada", currentValue: 3 });

    fireEvent.click(await screen.findByRole("button", { name: /No Relationship/ }));

    await waitFor(() => expect($delete).toHaveBeenCalledWith({ param: { relateeId: "m1" } }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
