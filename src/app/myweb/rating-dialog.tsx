"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { RelationCandidatesFeed } from "@/lib/api-types";

import { RELATION_CANDIDATES_QUERY_KEY, RELATION_SUBGRAPH_QUERY_KEY } from "./query-keys";

// Vocabulary lives in design-relations.md; mirrored here so the dialog
// reads the same to a member as the design intends. Keep in sync.
const VALUE_LABELS: Record<1 | 2 | 3 | 4, { headline: string; detail: string }> = {
  1: { headline: "Met in a group", detail: "We've met in group settings and know of each other." },
  2: { headline: "Talked 1-on-1", detail: "We've spent some time talking 1-on-1 enjoyably." },
  3: { headline: "Friend", detail: "Friend." },
  4: { headline: "Deep trust", detail: "Deep trust and knowing." },
};

const VALUES = [1, 2, 3, 4] as const;

export type RatingTarget = {
  id: string;
  displayName: string | null;
  hintAttribution?: string | null;
  currentValue?: 1 | 2 | 3 | 4 | null;
};

type Props = {
  target: RatingTarget | null;
  onClose: () => void;
};

export function RatingDialog({ target, onClose }: Props) {
  const queryClient = useQueryClient();
  const [pendingValue, setPendingValue] = useState<1 | 2 | 3 | 4 | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ relateeId, value }: { relateeId: string; value: 1 | 2 | 3 | 4 }) => {
      const res = await apiClient.api.relations.value[":relateeId"].$put({
        param: { relateeId },
        json: { value },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `relations/value: ${res.status}`);
      }
      return res.json();
    },
    // Optimistically drop the rated candidate from both feed sections so
    // the card vanishes before the round-trip lands. onError rolls back.
    onMutate: async ({ relateeId }) => {
      await queryClient.cancelQueries({ queryKey: RELATION_CANDIDATES_QUERY_KEY });
      const previous = queryClient.getQueryData<RelationCandidatesFeed>(RELATION_CANDIDATES_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<RelationCandidatesFeed>(RELATION_CANDIDATES_QUERY_KEY, {
          suggestions: previous.suggestions.filter((c) => c.id !== relateeId),
          otherMembers: previous.otherMembers.filter((c) => c.id !== relateeId),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(RELATION_CANDIDATES_QUERY_KEY, ctx.previous);
      }
    },
    onSettled: () => {
      // Re-sync candidates and subgraph so any newly-revealed cards
      // (e.g. inviter's connections opened up by this rating) appear
      // and the graph picks up the new edge once it exists.
      queryClient.invalidateQueries({ queryKey: RELATION_CANDIDATES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RELATION_SUBGRAPH_QUERY_KEY });
    },
  });

  const rate = (value: 1 | 2 | 3 | 4) => {
    if (!target || mutation.isPending) return;
    setPendingValue(value);
    mutation.mutate(
      { relateeId: target.id, value },
      {
        onSuccess: () => {
          setPendingValue(null);
          onClose();
        },
        onError: () => {
          setPendingValue(null);
        },
      },
    );
  };

  // 1–4 keyboard shortcut while the dialog is open. Re-attached on
  // every render — cheap, and avoids stale closures on `rate` /
  // `target`. Skips when a text field would have caught the keystroke.
  useEffect(() => {
    if (!target) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
        return;
      }
      const n = Number.parseInt(e.key, 10);
      if (n >= 1 && n <= 4) {
        e.preventDefault();
        rate(n as 1 | 2 | 3 | 4);
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  });

  const open = target !== null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !mutation.isPending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/20 data-ending-style:opacity-0 data-starting-style:opacity-0 transition-opacity duration-150" />
        <Dialog.Popup
          className="fixed top-1/2 left-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded border border-border bg-popover p-5 text-popover-foreground shadow-lg data-ending-style:opacity-0 data-starting-style:opacity-0 transition-opacity duration-150"
          aria-describedby={target?.hintAttribution ? "rating-attribution" : undefined}
        >
          <Dialog.Title className="font-heading text-base font-medium">
            {target?.currentValue ? "Update your relation with" : "Rate your relation with"}{" "}
            {target?.displayName ?? "this member"}
          </Dialog.Title>
          {target?.hintAttribution && (
            <p id="rating-attribution" className="mt-1 text-sm text-muted-foreground">
              {target.hintAttribution}
            </p>
          )}

          <div className="mt-4 flex flex-col gap-2">
            {VALUES.map((value) => {
              const { headline, detail } = VALUE_LABELS[value];
              const isCurrent = target?.currentValue === value;
              const isPending = pendingValue === value;
              return (
                <Button
                  key={value}
                  variant={isCurrent ? "secondary" : "primary"}
                  className="h-auto justify-start gap-3 px-3 py-2 text-left"
                  disabled={mutation.isPending}
                  onClick={() => rate(value)}
                >
                  <span className="text-lg font-bold tabular-nums">{value}</span>
                  <span className="flex flex-col">
                    <span className="font-semibold">{headline}</span>
                    <span className="text-sm text-muted-foreground">{detail}</span>
                  </span>
                  {isPending && <span className="ml-auto text-sm text-muted-foreground">…</span>}
                </Button>
              );
            })}
          </div>

          {mutation.isError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Couldn&apos;t save the rating. Click again to retry.
            </p>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            Click outside or press 1–4 to choose. Closing without choosing leaves the suggestion as-is.
          </p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
