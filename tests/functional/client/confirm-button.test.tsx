import { act, fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("button", { name: "Leaving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
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

  it("keeps the trigger disabled while the caller holds `pending`", () => {
    renderButton({ pending: true });
    expect(screen.getByRole("button", { name: "Leave program" })).toBeDisabled();
  });

  it("disables only the trigger when `disabled` is set", () => {
    renderButton({ disabled: true });
    expect(screen.getByRole("button", { name: "Leave program" })).toBeDisabled();
  });
});
