"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { RelationCandidatesFeed } from "@/lib/api-types";

import { FlyCard } from "./fly-card";
import { RELATION_CANDIDATES_QUERY_KEY, RELATION_SUBGRAPH_QUERY_KEY } from "./query-keys";
import { RelatingDialog, type RelatingTarget } from "./relating-dialog";
import { WebBuilder } from "./web-builder";
import { WebGraph } from "./web-graph";
import { WelcomeTour } from "./welcome-tour";

type Mode = "edit" | "view";

const TOUR_DISMISSED_KEY = "isweb-welcome-tour-dismissed";

// How long a just-related card takes to fly from the list into the graph.
const FLY_DURATION_MS = 550;

type Flying = {
  candidateId: string;
  card: { displayName: string | null; avatarUrl: string | null; location: string | null };
  sourceRect: { left: number; top: number; width: number; height: number };
  target: { x: number; y: number };
};

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
  // graph (WebGraph) can request a relating dialog from a single source.
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

  const queryClient = useQueryClient();
  // The suggestion card currently flying into the graph (null when idle).
  const [flying, setFlying] = useState<Flying | null>(null);

  // Drop the related candidate from the feed (closing the list hole) and
  // refresh the graph so the new node eases in from the center. Deferred to
  // here from the dialog (deferGraphCommit) so it fires at the fly's end.
  const commitRelation = useCallback(
    (candidateId: string) => {
      const prev = queryClient.getQueryData<RelationCandidatesFeed>(RELATION_CANDIDATES_QUERY_KEY);
      if (prev) {
        queryClient.setQueryData<RelationCandidatesFeed>(RELATION_CANDIDATES_QUERY_KEY, {
          suggestions: prev.suggestions.filter((c) => c.id !== candidateId),
          otherMembers: prev.otherMembers.filter((c) => c.id !== candidateId),
        });
      }
      queryClient.invalidateQueries({ queryKey: RELATION_CANDIDATES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RELATION_SUBGRAPH_QUERY_KEY });
    },
    [queryClient],
  );

  // On a successful relation: advance the tour, then fly the card into the
  // graph if it's a card-add (a card + graph are on screen); otherwise (e.g.
  // an edge-click edit) just commit immediately.
  const handleRelated = useCallback(
    (relateeId: string) => {
      if (tourRun) setTourAdvanceToken((t) => t + 1);
      const feed = queryClient.getQueryData<RelationCandidatesFeed>(RELATION_CANDIDATES_QUERY_KEY);
      const candidate = feed && [...feed.suggestions, ...feed.otherMembers].find((c) => c.id === relateeId);
      const cardEl = document.querySelector(`[data-candidate-id="${relateeId}"]`);
      const graphEl = document.querySelector('[data-tour="graph"]');
      if (!candidate || !cardEl || !graphEl) {
        commitRelation(relateeId);
        return;
      }
      const r = cardEl.getBoundingClientRect();
      const g = graphEl.getBoundingClientRect();
      setFlying({
        candidateId: relateeId,
        card: { displayName: candidate.displayName, avatarUrl: candidate.avatarUrl, location: candidate.location },
        sourceRect: { left: r.left, top: r.top, width: r.width, height: r.height },
        target: { x: g.left + g.width / 2, y: g.top + g.height / 2 },
      });
    },
    [queryClient, commitRelation, tourRun],
  );

  const handleFlyDone = useCallback(() => {
    if (flying) commitRelation(flying.candidateId);
    setFlying(null);
  }, [flying, commitRelation]);

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
    <div className="flex w-full flex-col items-center gap-6">
      {/* Below 600px the graph breaks out of the page's horizontal padding to
       * go edge-to-edge; the title/breadcrumb (page) and the Edit/Done row +
       * feed (below) keep their padding. The negative margin equals -(50vw -
       * half the container), the canonical full-bleed within a padded parent. */}
      <div className="w-full max-[600px]:mx-[calc(50%_-_50vw)] max-[600px]:w-screen">
        <WebGraph square={mode === "view"} onOpenRelating={setRelatingTarget} onReplayTour={replayTour} />
      </div>

      {/* Toggle floats in the right gutter so it doesn't claim its own
       * row. Edit and Done sit at the same coordinates across modes —
       * same affordance, different label. Capped at max-w-5xl so the
       * builder and toggle stay readable even though the view-mode graph
       * above now spans wider. */}
      <div className="relative w-full max-w-5xl">
        <div className="absolute right-0 top-0 z-10 flex flex-col items-end gap-2">
          {mode === "edit" ? (
            <Button variant="secondary" data-tour="done-button" disabled={markDone.isPending} onClick={handleDoneClick}>
              {markDone.isPending ? "Saving…" : "Done"}
            </Button>
          ) : (
            <Button onClick={() => setMode("edit")}>Edit</Button>
          )}
          {markDone.isError && (
            <p role="alert" className="text-sm text-destructive">
              Couldn&apos;t save your update — your relationships are still saved.
            </p>
          )}
        </div>

        {mode === "edit" && (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <WebBuilder onOpenRelating={setRelatingTarget} flyingId={flying?.candidateId ?? null} />
          </div>
        )}
      </div>

      <RelatingDialog
        target={relatingTarget}
        deferGraphCommit
        onClose={() => setRelatingTarget(null)}
        onRelated={handleRelated}
      />
      {flying && (
        <FlyCard
          card={flying.card}
          sourceRect={flying.sourceRect}
          target={flying.target}
          durationMs={FLY_DURATION_MS}
          onDone={handleFlyDone}
        />
      )}
      <WelcomeTour key={tourKey} run={tourRun} advanceToken={tourAdvanceToken} onClose={dismissTour} />
    </div>
  );
}
