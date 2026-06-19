"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useNewVersionAvailable } from "@/lib/use-new-version-available";
import { cn } from "@/lib/utils";

// Per-tier copy, with the Reload button rendered inline between `before` and
// `after` so each sentence reads as one instruction with the button as its
// verb. Patch and feature share the relaxed "when convenient"; only urgent
// escalates the timing and renders no dismiss control. The patch/feature
// split lives in the "what": patch is a bare new version, feature names the
// member-facing win. See docs/strategy-deployment.md.
const COPY = {
  patch: { before: "A new version of the app is ready: please ", after: " when convenient." },
  feature: { before: "The app has new features for you: please ", after: " when convenient." },
  urgent: { before: "An urgent update to the app is ready: please ", after: " at the first opportunity." },
} as const;

// The "an update is available" prompt: a persistent card pinned to the
// bottom of the viewport, mounted once in the root layout. The hook decides
// which tier (if any) to surface; this renders its copy. Reload is a full
// document navigation so it pulls the latest production bundle. See
// docs/strategy-deployment.md.
export function UpdateBanner() {
  const { tier, dismiss } = useNewVersionAvailable();
  if (!tier) return null;

  const urgent = tier === "urgent";
  const { before, after } = COPY[tier];

  return (
    // The outer layer spans the viewport but is click-through; only the card
    // itself catches pointer events, so the banner never blocks the page.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4">
      <div
        role={urgent ? "alert" : "status"}
        className={cn(
          "pointer-events-auto flex max-w-[360px] items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-foreground shadow-lg",
          urgent ? "border-primary/50" : "border-border",
        )}
      >
        <p className="min-w-0">
          {before}
          {/* h-auto + py drops the fixed h-7 so the pill hugs its label; align-baseline
              then sits that label on the sentence's baseline, not floating above it. */}
          <Button
            size="sm"
            variant="secondary"
            className="h-auto py-0.5 align-baseline"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
          {after}
        </p>
        {!urgent && (
          <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={dismiss}>
            <X />
          </Button>
        )}
      </div>
    </div>
  );
}
