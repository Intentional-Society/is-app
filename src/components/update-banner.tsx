"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useNewVersionAvailable } from "@/lib/use-new-version-available";
import { cn } from "@/lib/utils";

// The "an update is available" prompt: a persistent card pinned to the
// bottom of the viewport, mounted once in the root layout. The hook decides
// which tier (if any) to surface; this renders it. Reload is a full document
// navigation so it pulls the latest production bundle. See
// docs/strategy-deployment.md.
export function UpdateBanner() {
  const { tier, dismiss } = useNewVersionAvailable();
  if (!tier) return null;

  const urgent = tier === "urgent";
  const message = urgent ? "An important update is ready." : "A new version is available.";

  return (
    // The outer layer spans the viewport but is click-through; only the card
    // itself catches pointer events, so the banner never blocks the page.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4">
      <div
        role={urgent ? "alert" : "status"}
        className={cn(
          "pointer-events-auto flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm text-foreground shadow-lg",
          urgent ? "border-primary/50" : "border-border",
        )}
      >
        <span>{message}</span>
        <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
          Reload
        </Button>
        {!urgent && (
          <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={dismiss}>
            <X />
          </Button>
        )}
      </div>
    </div>
  );
}
