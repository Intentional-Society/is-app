import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmButton } from "@/components/confirm-button";

const renderButton = (props: Partial<React.ComponentProps<typeof ConfirmButton>> = {}) => {
  const onConfirm = props.onConfirm ?? vi.fn();
  const ui = (p: Partial<React.ComponentProps<typeof ConfirmButton>>) => (
    <ConfirmButton
      label="Leave program"
      confirmLabel="Yes, leave program"
      pendingLabel="Leaving…"
      {...p}
      onConfirm={onConfirm}
    />
  );
  render(ui(props));
  return { onConfirm };
};

// Holds `pending` after the action resolves, like a delete that is navigating away.
function Harness() {
  const [locked, setLocked] = useState(false);
  return (
    <ConfirmButton
      label="Leave program"
      confirmLabel="Yes, leave program"
      pendingLabel="Leaving…"
      pending={locked}
      onConfirm={() => {
        setLocked(true);
        return Promise.resolve();
      }}
    />
  );
}

describe("ConfirmButton", () => {
  it("asks first: the trigger opens the confirm step without firing onConfirm", () => {
    const { onConfirm } = renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    expect(screen.getByRole("button", { name: "Yes, leave program" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave program" })).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("fires onConfirm once when the confirm button is clicked", () => {
    const { onConfirm } = renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, leave program" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("moves focus to Cancel when it opens, and back to the trigger on cancel", () => {
    const { onConfirm } = renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Leave program" })).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not take focus on first render", () => {
    renderButton();
    expect(screen.getByRole("button", { name: "Leave program" })).not.toHaveFocus();
  });

  it("locks both buttons with the pending label until onConfirm settles, then closes", async () => {
    let settle: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    renderButton({ onConfirm });
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, leave program" }));
    expect(screen.getByRole("button", { name: "Leaving…" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("aria-disabled", "true");
    await act(async () => settle());
    expect(screen.getByRole("button", { name: "Leave program" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("closes, without throwing, when onConfirm rejects", async () => {
    renderButton({ onConfirm: () => Promise.reject(new Error("boom")) });
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, leave program" }));
    expect(await screen.findByRole("button", { name: "Leave program" })).toBeEnabled();
  });

  it("returns focus to the trigger after a confirmed action settles", async () => {
    renderButton({ onConfirm: () => Promise.resolve() });
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, leave program" }));
    expect(await screen.findByRole("button", { name: "Leave program" })).toHaveFocus();
  });

  // The trigger uses aria-disabled (not the `disabled` attribute) so it can hold focus.
  it("keeps the trigger inert while the caller holds `pending`", () => {
    const { onConfirm } = renderButton({ pending: true });
    const trigger = screen.getByRole("button", { name: "Leave program" });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(trigger);
    expect(screen.queryByRole("button", { name: "Yes, leave program" })).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("makes only the trigger inert when `disabled` is set", () => {
    renderButton({ disabled: true });
    const trigger = screen.getByRole("button", { name: "Leave program" });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(trigger);
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("still returns focus to a trigger that comes back locked by the caller", async () => {
    // Mirrors a delete that succeeded and is navigating away: the step closes,
    // but the caller keeps `pending` set.
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, leave program" }));
    const trigger = await screen.findByRole("button", { name: "Leave program" });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveFocus();
  });
  it("closes the step on Escape and returns focus to the trigger", () => {
    const { onConfirm } = renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
    expect(screen.getByRole("button", { name: "Leave program" })).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ignores Escape while the request runs, and keeps focus on the button it was on", () => {
    renderButton({ onConfirm: () => new Promise<void>(() => {}) });
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, leave program" }));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Leaving…" })).toBeInTheDocument();
  });

  it("closes an open step when the action becomes unavailable", () => {
    const props = {
      label: "Leave program",
      confirmLabel: "Yes, leave program",
      pendingLabel: "Leaving…",
      onConfirm: vi.fn(),
    };
    const { rerender } = render(<ConfirmButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    expect(screen.getByRole("button", { name: "Yes, leave program" })).toBeInTheDocument();
    rerender(<ConfirmButton {...props} disabled />);
    expect(screen.queryByRole("button", { name: "Yes, leave program" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave program" })).toHaveAttribute("aria-disabled", "true");
  });
  it("leaves focus alone when the step closes after the user moved to another control", async () => {
    let settle: () => void = () => {};
    render(
      <>
        <input aria-label="elsewhere" />
        <ConfirmButton
          label="Leave program"
          confirmLabel="Yes, leave program"
          pendingLabel="Leaving…"
          onConfirm={() => new Promise<void>((resolve) => (settle = resolve))}
        />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Leave program" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, leave program" }));
    screen.getByLabelText("elsewhere").focus();
    await act(async () => settle());
    expect(screen.getByRole("button", { name: "Leave program" })).toBeInTheDocument();
    expect(screen.getByLabelText("elsewhere")).toHaveFocus();
  });
});
