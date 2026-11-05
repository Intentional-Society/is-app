import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiClient: {
    api: {
      admin: {
        programs: {
          ":id": {
            "message-box": { $get: vi.fn(), $patch: vi.fn() },
          },
        },
      },
    },
  },
}));

// MDXEditor is client-only and loaded lazily; a plain textarea stands in.
vi.mock("@/components/markdown-editor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    ariaLabel,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    ariaLabel: string;
    disabled?: boolean;
  }) => (
    <textarea aria-label={ariaLabel} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { MessageBoxSettings } from "@/app/admin/programs/[id]/message-box-settings";
import { apiClient } from "@/lib/api";

const route = apiClient.api.admin.programs[":id"]["message-box"];
const $get = vi.mocked(route.$get);
const $patch = vi.mocked(route.$patch);

const mockSettings = (settings: { visibility: "members" | "admins"; prompt: string | null }) => {
  $get.mockResolvedValue({ ok: true, json: async () => settings } as never);
};

const renderSettings = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MessageBoxSettings programId="p1" />
    </QueryClientProvider>,
  );
};

describe("MessageBoxSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts clean: shows the saved values and a disabled Save button", async () => {
    mockSettings({ visibility: "members", prompt: "Hello" });
    renderSettings();
    expect(await screen.findByRole("radio", { name: /All members/ })).toBeChecked();
    expect(screen.getByLabelText("Message box prompt")).toHaveValue("Hello");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("does not save when a radio is clicked; it waits for Save changes", async () => {
    mockSettings({ visibility: "admins", prompt: null });
    renderSettings();
    fireEvent.click(await screen.findByRole("radio", { name: /All members/ }));

    expect(screen.getByRole("radio", { name: /All members/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    expect($patch).not.toHaveBeenCalled();
  });

  it("saves the visibility and the trimmed prompt together in one request", async () => {
    mockSettings({ visibility: "admins", prompt: null });
    $patch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as never);
    renderSettings();

    fireEvent.click(await screen.findByRole("radio", { name: /All members/ }));
    fireEvent.change(screen.getByLabelText("Message box prompt"), { target: { value: "  Won't be there?  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect($patch).toHaveBeenCalledWith({
        param: { id: "p1" },
        json: { visibility: "members", prompt: "Won't be there?" },
      }),
    );
    expect($patch).toHaveBeenCalledTimes(1);
  });

  it("sends a blank prompt as null", async () => {
    mockSettings({ visibility: "admins", prompt: "Old" });
    $patch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as never);
    renderSettings();

    fireEvent.change(await screen.findByLabelText("Message box prompt"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect($patch).toHaveBeenCalledWith({ param: { id: "p1" }, json: { visibility: "admins", prompt: null } }),
    );
  });

  it("keeps the edits and shows the error when saving fails", async () => {
    mockSettings({ visibility: "admins", prompt: null });
    $patch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "prompt is too long" }) } as never);
    renderSettings();

    fireEvent.click(await screen.findByRole("radio", { name: /All members/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("prompt is too long");
    expect(screen.getByRole("radio", { name: /All members/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("shows Saved after a successful save and the refetch", async () => {
    mockSettings({ visibility: "admins", prompt: null });
    $patch.mockImplementation((async () => {
      mockSettings({ visibility: "members", prompt: null });
      return { ok: true, json: async () => ({ ok: true }) };
    }) as never);
    renderSettings();

    fireEvent.click(await screen.findByRole("radio", { name: /All members/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Saved.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
