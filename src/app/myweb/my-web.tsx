"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";

import { RELATION_CANDIDATES_QUERY_KEY, RELATION_SUBGRAPH_QUERY_KEY } from "./query-keys";
import { WebBuilder } from "./web-builder";

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
      // Other members' feeds may now surface me as recently active,
      // and my own subgraph view stays fresh.
      queryClient.invalidateQueries({ queryKey: RELATION_CANDIDATES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RELATION_SUBGRAPH_QUERY_KEY });
      onDone();
    },
  });
};

export function MyWeb({ initialLastUpdatedWeb }: { initialLastUpdatedWeb: Date | null }) {
  // First-ever visit lands in Edit so new members aren't staring at a
  // blank graph; returning members open in View since their last action
  // was the explicit "I'm done" click. Either way, the Edit/Done button
  // toggles freely afterward.
  const [mode, setMode] = useState<Mode>(initialLastUpdatedWeb ? "view" : "edit");
  const markDone = useMarkDone(() => setMode("view"));

  return (
    <>
      {mode === "edit" ? (
        <div className="flex w-full max-w-3xl flex-col gap-4">
          <WebBuilder />
          <Button
            variant="secondary"
            className="self-start"
            disabled={markDone.isPending}
            onClick={() => markDone.mutate()}
          >
            {markDone.isPending ? "Saving…" : "Done"}
          </Button>
          {markDone.isError && (
            <p role="alert" className="text-sm text-destructive">
              Couldn&apos;t save your update — your ratings are still saved.
            </p>
          )}
        </div>
      ) : (
        <div className="flex w-full max-w-3xl flex-col gap-4">
          <p className="text-base text-muted-foreground">
            Your web is your view of the network — your ratings shape who shows up next time.
          </p>
          <Button className="self-start" onClick={() => setMode("edit")}>
            Edit
          </Button>
        </div>
      )}
    </>
  );
}
