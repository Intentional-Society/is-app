import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiClient: {
    api: {
      relations: {
        value: {
          ":relateeId": {
            $get: vi.fn(),
            $put: vi.fn(),
          },
        },
      },
    },
  },
}));

import { apiClient } from "@/lib/api";
import { MemberRelationControl } from "@/app/members/[id]/relation-control";

const $get = vi.mocked(apiClient.api.relations.value[":relateeId"].$get);

const mockValue = (value: number | null) => {
  $get.mockResolvedValue({ ok: true, json: async () => ({ value }) } as never);
};

const mockFailure = () => {
  $get.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);
};

const renderControl = (ui: ReactNode) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

describe("MemberRelationControl", () => {
  it("shows the relation strength headline for an existing relation", async () => {
    mockValue(2);
    renderControl(<MemberRelationControl memberId="m1" memberName="Ada" />);

    // Regression guard: the label must render the headline string, not the
    // RELATION_VALUE_LABELS object (which stringifies to "[object Object]").
    expect(await screen.findByText("Connected · Talked 1-on-1")).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
  });

  it("shows a connect affordance when there is no relation", async () => {
    mockValue(null);
    renderControl(<MemberRelationControl memberId="m1" memberName="Ada" />);

    expect(await screen.findByText("Not yet connected")).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect" })).toBeVisible();
  });

  it("surfaces a load error instead of masking it as 'not connected'", async () => {
    mockFailure();
    renderControl(<MemberRelationControl memberId="m1" memberName="Ada" />);

    expect(await screen.findByText("Couldn't load connection")).toBeVisible();
  });
});
