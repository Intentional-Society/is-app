"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { RelationCandidatesFeed } from "@/lib/api-types";
import {
  RELATION_VALUE_LABELS,
  RELATION_VALUE_VISIBILITY_NOTE,
  RELATION_VALUES,
  type RelationValue,
} from "@/lib/relation-value";

import { RELATION_CANDIDATES_QUERY_KEY, RELATION_SUBGRAPH_QUERY_KEY, relationValueQueryKey } from "./query-keys";

export type RelatingTarget = {
  id: string;
  displayName: string | null;
  hintAttribution?: string | null;
  currentValue?: RelationValue | null;
};

type Props = {
  target: RelatingTarget | null;
  onClose: () => void;
  // Fires only after a relation is successfully committed. Used by
  // /myweb to advance the welcome tour once the user completes the
  // "add people" step's action.
  onRelated?: () => void;
};

export function RelatingDialog({ target, onClose, onRelated }: Props) {
  const queryClient = useQueryClient();
  const [pendingValue, setPendingValue] = useState<RelationValue | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ relateeId, value }: { relateeId: string; value: RelationValue }) => {
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
    onSettled: (_data, _err, { relateeId }) => {
      // Re-sync candidates and subgraph so any newly-revealed cards
      // (e.g. inviter's connections opened up by this rating) appear
      // and the graph picks up the new edge once it exists.
      queryClient.invalidateQueries({ queryKey: RELATION_CANDIDATES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RELATION_SUBGRAPH_QUERY_KEY });
      // Refresh any per-member value reads (e.g. the member-profile control)
      // so the displayed strength reflects the edit.
      queryClient.invalidateQueries({ queryKey: relationValueQueryKey(relateeId) });
    },
  });

  const relate = (value: RelationValue) => {
    if (!target || mutation.isPending) return;
    setPendingValue(value);
    mutation.mutate(
      { relateeId: target.id, value },
      {
        onSuccess: () => {
          setPendingValue(null);
          onClose();
          onRelated?.();
        },
        onError: () => {
          setPendingValue(null);
        },
      },
    );
  };

  // 1–4 keyboard shortcut while the dialog is open. Re-attached on
  // every render — cheap, and avoids stale closures on `relate` /
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
        relate(n as RelationValue);
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
          aria-describedby={
            target?.hintAttribution ? "relating-attribution relating-instruction" : "relating-instruction"
          }
        >
          <Dialog.Close
            disabled={mutation.isPending}
            aria-label="Close"
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </Dialog.Close>
          <Dialog.Title className="pr-8 font-heading text-base font-medium">
            Who is <span className="font-semibold">{target?.displayName ?? "this member"}</span> to you?
          </Dialog.Title>
          {target?.hintAttribution && (
            <p id="relating-attribution" className="mt-1 text-sm text-muted-foreground">
              ({target.hintAttribution})
            </p>
          )}
          <p id="relating-instruction" className="mt-1 text-sm text-muted-foreground">
            On a scale of 1-to-4, please estimate how deep <em className="italic">you</em> feel your relationship is.
          </p>

          <p className="mt-3 text-xs text-muted-foreground">
            Keyboard shortcuts: Number keys 1 through 4, or Esc to cancel
          </p>

          <div className="mt-2 flex flex-col gap-2">
            {RELATION_VALUES.map((value) => {
              const { headline, detail } = RELATION_VALUE_LABELS[value];
              const isCurrent = target?.currentValue === value;
              const isPending = pendingValue === value;
              return (
                <Button
                  key={value}
                  variant={isCurrent ? "secondary" : "primary"}
                  className="h-auto justify-start gap-3 px-3 py-2 text-left whitespace-normal"
                  disabled={mutation.isPending}
                  onClick={() => relate(value)}
                >
                  <span className="text-lg font-bold tabular-nums">{value}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{headline}</span>
                    <span className="text-sm leading-snug text-muted-foreground">{detail}</span>
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

          <p className="mt-3 text-xs text-muted-foreground">Notes: {RELATION_VALUE_VISIBILITY_NOTE}</p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
