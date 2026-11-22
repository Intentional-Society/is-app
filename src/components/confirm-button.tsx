"use client";
import { type ComponentProps, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonProps = ComponentProps<typeof Button>;

// Two-step action button: the trigger swaps for a "Yes, …" confirm button and a
// Cancel. It renders a fragment, so the caller's flex row sets the layout.
//
// `onConfirm` may return a promise. The confirm step stays locked ("pending")
// until it settles, then closes, whether it succeeded or failed. Resolve it only
// once the UI reflects the result (for example, after the refetch lands), or the
// trigger comes back enabled over stale data. The caller shows any error; a
// rejection here is swallowed. `pending` adds an outside lock for state this
// component can't see, such as a request that has finished but is still
// navigating away.
//
// Focus follows the swap: Cancel takes it when the step opens (the safe
// default), and the trigger gets it back when the step closes, so keyboard and
// screen-reader users keep their place. Escape closes the step unless a request
// is running. All three buttons stay focusable while locked (`aria-disabled`),
// so locking one never throws focus to <body>; the trigger can also come back
// still locked, for example after a delete that is navigating away. If the
// caller unmounts this component when the action succeeds (a leave button
// replaced by a join button), there is no trigger left to refocus, and the
// caller owns focus.
export function ConfirmButton({
  label,
  confirmLabel,
  pendingLabel,
  onConfirm,
  pending = false,
  disabled = false,
  size,
  triggerVariant = "primary",
  cancelVariant = "secondary",
  triggerClassName,
  actionClassName,
}: {
  /** Trigger text, shown before the user commits. */
  label: string;
  /** Confirm button text, e.g. "Yes, leave program". */
  confirmLabel: string;
  /** Confirm button text while its own request runs, e.g. "Leaving…". */
  pendingLabel: string;
  onConfirm: () => Promise<unknown> | undefined;
  /** Extra lock held by the caller. Locks the buttons; the label changes only for `onConfirm`'s own request. */
  pending?: boolean;
  /** Disables the trigger, and closes the step if it is open. */
  disabled?: boolean;
  size?: ButtonProps["size"];
  triggerVariant?: ButtonProps["variant"];
  cancelVariant?: ButtonProps["variant"];
  triggerClassName?: string;
  /** Applied to both the confirm and Cancel buttons. */
  actionClassName?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  // The action became unavailable while the step was open, so confirming it
  // would only be rejected.
  useEffect(() => {
    if (disabled) setConfirming(false);
  }, [disabled]);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) triggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const busy = pending || submitting;
  const confirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
    } catch {
      // The caller owns error reporting.
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  };

  const lockedClass = "aria-disabled:pointer-events-none aria-disabled:opacity-50";
  const closeOnEscape = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !busy) setConfirming(false);
  };
  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant={triggerVariant}
        size={size}
        disabled={disabled || busy}
        focusableWhenDisabled
        onClick={() => setConfirming(true)}
        className={cn(lockedClass, triggerClassName)}
      >
        {label}
      </Button>
    );
  }
  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size={size}
        disabled={busy}
        focusableWhenDisabled
        onClick={confirm}
        onKeyDown={closeOnEscape}
        className={cn(lockedClass, actionClassName)}
      >
        {submitting ? pendingLabel : confirmLabel}
      </Button>
      <Button
        ref={cancelRef}
        type="button"
        variant={cancelVariant}
        size={size}
        disabled={busy}
        focusableWhenDisabled
        onClick={() => setConfirming(false)}
        onKeyDown={closeOnEscape}
        className={cn(lockedClass, actionClassName)}
      >
        Cancel
      </Button>
    </>
  );
}
