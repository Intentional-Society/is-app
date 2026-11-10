import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UndoNotices } from "@/components/undo-notices";
import type { UndoEntry } from "@/lib/use-undo-queue";

const entry = (id: string, message: string): UndoEntry => ({
  id,
  message,
  onUndo: vi.fn(),
  expiresAt: Date.now() + 30_000,
});

describe("UndoNotices", () => {
  it("keeps a live region mounted even with no notices, so later additions are announced", () => {
    render(<UndoNotices entries={[]} onUndo={vi.fn()} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("gives each Undo button its own fixed accessible name and hides the countdown from assistive tech", () => {
    render(
      <UndoNotices
        entries={[entry("a", "Archived Ada's message."), entry("b", "Deleting Bo's message.")]}
        onUndo={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Undo: Archived Ada's message." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo: Deleting Bo's message." })).toBeInTheDocument();
    const [first] = screen.getAllByText(/Undo \(\d+s\)/);
    expect(first).toHaveAttribute("aria-hidden", "true");
  });

  it("calls onUndo with the entry id", () => {
    const onUndo = vi.fn();
    render(<UndoNotices entries={[entry("a", "Archived Ada's message.")]} onUndo={onUndo} />);
    fireEvent.click(screen.getByRole("button", { name: /^Undo/ }));
    expect(onUndo).toHaveBeenCalledWith("a");
  });
});
