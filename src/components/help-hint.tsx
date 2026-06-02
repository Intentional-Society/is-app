"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A small "?" button beside a heading that toggles a popover of help
// text. Click-to-toggle (not hover) so it stays reachable on touch —
// the same affordance as the "?" hint on /myweb's canvas. Page-agnostic:
// pass the body as children, an accessible `label`, and `align` to pick
// which side the popover opens from (use "right" when the trigger sits
// near the right edge of its container).
export function HelpHint({
  children,
  label = "More information",
  align = "left",
}: {
  children: React.ReactNode;
  label?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full border border-border bg-background/90 font-bold"
      >
        ?
      </Button>
      {open && (
        <div
          className={cn(
            "absolute top-full z-50 mt-2 w-64 rounded border border-border bg-background p-3 text-left text-sm text-muted-foreground shadow-md",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
