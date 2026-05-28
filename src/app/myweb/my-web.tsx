"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";

import { RELATION_CANDIDATES_QUERY_KEY, RELATION_SUBGRAPH_QUERY_KEY } from "./query-keys";
import { RelatingDialog, type RelatingTarget } from "./relating-dialog";
import { WebBuilder } from "./web-builder";
import { WebGraph } from "./web-graph";
import { WelcomeTour } from "./welcome-tour";

type Mode = "edit" | "view";

const TOUR_DISMISSED_KEY = "isweb-welcome-tour-dismissed";

// Done captures intent ("I'm done updating for now") and surfaces the
// member in others' "recently active" suggestion source. Real-time
// edits don't bump it — this button is the only writer.
const useMarkDone = (onDone: () => void) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.api.me["last-updated-web"].$put();
      if (!res.ok) throw new Error(`me/last-updated-web: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RELATION_CANDIDATES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RELATION_SUBGRAPH_QUERY_KEY });
      onDone();
    },
  });
};

export function MyWeb({ initialLastUpdatedWeb }: { initialLastUpdatedWeb: Date | null }) {
  // First-ever visit lands in Edit so new members aren't staring at a
  // blank graph; returning members open in View since their last action
  // was the explicit "I'm done" click. The toggle is freely flipable.
  const [mode, setMode] = useState<Mode>(initialLastUpdatedWeb ? "view" : "edit");
  // Lifted to MyWeb so both the suggestion feed (WebBuilder) and the
  // graph (WebGraph) can request a rating dialog from a single source.
  const [relatingTarget, setRelatingTarget] = useState<RelatingTarget | null>(null);
  // Controlled tour state so a "Replay guided tour" action can re-fire
  // it for returning members. The initial-run decision (first visit,
  // not already dismissed this session) runs in an effect so SSR markup
  // matches the hydrated tree. The sessionStorage check still makes
  // e2e tests trivial: addInitScript with the flag and the tour stays off.
  const [tourRun, setTourRun] = useState(false);
  // Bumped on replay so Joyride fully unmounts/remounts — toggling
  // `run` alone doesn't reliably reset stepIndex back to 0.
  const [tourKey, setTourKey] = useState(0);
  // Bumped after a successful relation so the tour advances past the
  // "click anyone here" step automatically.
  const [tourAdvanceToken, setTourAdvanceToken] = useState(0);
  useEffect(() => {
    if (initialLastUpdatedWeb !== null) return;
    if (window.sessionStorage.getItem(TOUR_DISMISSED_KEY) === "1") return;
    setTourRun(true);
  }, [initialLastUpdatedWeb]);
  const markDone = useMarkDone(() => setMode("view"));

  const dismissTour = () => {
    setTourRun(false);
    window.sessionStorage.setItem(TOUR_DISMISSED_KEY, "1");
  };

  // Done is the tour's intended finisher — close the tour synchronously
  // on click so the tooltip doesn't linger while the mutation runs.
  const handleDoneClick = () => {
    dismissTour();
    markDone.mutate();
  };

  const replayTour = () => {
    // The tour spotlights edit-mode UI (the suggestion feed, the Done
    // button); ensure we're in edit mode before it starts, otherwise
    // those targets don't exist on the page.
    setMode("edit");
    window.sessionStorage.removeItem(TOUR_DISMISSED_KEY);
    setTourKey((k) => k + 1);
    setTourRun(true);
  };

  return (
    <div className="flex w-full max-w-5xl flex-col items-center gap-6">
      <WebGraph onOpenRelating={setRelatingTarget} onReplayTour={replayTour} />

      {/* Toggle floats in the right gutter so it doesn't claim its own
       * row. Edit and Done sit at the same coordinates across modes —
       * same affordance, different label. */}
      <div className="relative w-full">
        <div className="absolute right-0 top-0 z-10 flex flex-col items-end gap-2">
          {mode === "edit" ? (
            <Button
              variant="secondary"
              data-tour="done-button"
              disabled={markDone.isPending}
              onClick={handleDoneClick}
            >
              {markDone.isPending ? "Saving…" : "Done"}
            </Button>
          ) : (
            <Button onClick={() => setMode("edit")}>Edit</Button>
          )}
          {markDone.isError && (
            <p role="alert" className="text-sm text-destructive">
              Couldn&apos;t save your update — your ratings are still saved.
            </p>
          )}
        </div>

        {mode === "edit" && (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <WebBuilder onOpenRelating={setRelatingTarget} />
          </div>
        )}
      </div>

      <RelatingDialog
        target={relatingTarget}
        onClose={() => setRelatingTarget(null)}
        onRelated={() => {
          if (tourRun) setTourAdvanceToken((t) => t + 1);
        }}
      />
      <WelcomeTour key={tourKey} run={tourRun} advanceToken={tourAdvanceToken} onClose={dismissTour} />
    </div>
  );
}
