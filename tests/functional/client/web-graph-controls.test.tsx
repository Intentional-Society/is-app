import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Panel reads ReactFlow context; stub it to a passthrough div (as the WebGraph
// suite does) so the controls render in isolation.
vi.mock("@xyflow/react", () => ({
  Panel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import { WebGraphControls } from "@/app/myweb/web-graph-controls";
import type { RelationValue } from "@/lib/relation-value";

const makeProps = (
  over: Partial<ComponentProps<typeof WebGraphControls>> = {},
): ComponentProps<typeof WebGraphControls> => ({
  hops: 2,
  onHopsChange: vi.fn(),
  valueFilter: new Set<RelationValue>([1, 2, 3, 4]),
  onToggleValue: vi.fn(),
  ...over,
});

describe("WebGraphControls", () => {
  it("reflects the current hops in the checkbox", () => {
    render(<WebGraphControls {...makeProps({ hops: 1 })} />);
    expect(screen.getByRole("checkbox", { name: "Friends-of-friends" })).not.toBeChecked();
  });

  it("reports a hops change when the checkbox is toggled", () => {
    const onHopsChange = vi.fn();
    render(<WebGraphControls {...makeProps({ hops: 1, onHopsChange })} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Friends-of-friends" }));
    expect(onHopsChange).toHaveBeenCalledWith(2);
  });

  it("presses each depth pill according to the filter", () => {
    render(<WebGraphControls {...makeProps({ valueFilter: new Set<RelationValue>([3, 4]) })} />);
    expect(screen.getByRole("button", { name: "Depth 1: Acquaintance" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Depth 3: Close Friend" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Depth 4: Kin" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reports a depth toggle when a pill is clicked", () => {
    const onToggleValue = vi.fn();
    render(<WebGraphControls {...makeProps({ onToggleValue })} />);
    fireEvent.click(screen.getByRole("button", { name: "Depth 2: Friend" }));
    expect(onToggleValue).toHaveBeenCalledWith(2);
  });
});
