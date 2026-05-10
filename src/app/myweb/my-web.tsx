"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";

import { RELATION_CANDIDATES_QUERY_KEY, RELATION_SUBGRAPH_QUERY_KEY } from "./query-keys";
import { RatingDialog, type RatingTarget } from "./rating-dialog";
import { WebBuilder } from "./web-builder";
import { WebGraph } from "./web-graph";

type Mode = "edit" | "view";

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
  const [ratingTarget, setRatingTarget] = useState<RatingTarget | null>(null);
  const markDone = useMarkDone(() => setMode("view"));

  return (
    <div className="flex w-full max-w-5xl flex-col items-center gap-6">
      <WebGraph onOpenRating={setRatingTarget} />

      {/* Toggle floats in the right gutter under the graph so it doesn't
       * claim its own row — WebBuilder sits flush below the graph. Edit
       * and Done are the same affordance with a different label, so they
       * stay in the same coordinates across modes. */}
      <div className="relative w-full">
        <div className="absolute right-0 top-0 z-10 flex flex-col items-end gap-2">
          {mode === "edit" ? (
            <Button
              variant="secondary"
              disabled={markDone.isPending}
              onClick={() => markDone.mutate()}
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
            <WebBuilder onOpenRating={setRatingTarget} />
          </div>
        )}
      </div>

      <RatingDialog target={ratingTarget} onClose={() => setRatingTarget(null)} />
    </div>
  );
}
