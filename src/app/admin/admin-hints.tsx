"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Avatar } from "@/components/avatar";
import { MemberTypeahead } from "@/components/member-typeahead";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { MemberSummary } from "@/lib/api-types";

type PendingHint = {
  relator: { id: string; displayName: string | null; slug: string | null; avatarUrl: string | null };
  relatee: { id: string; displayName: string | null; slug: string | null; avatarUrl: string | null };
  hintedBy: { id: string; displayName: string | null; slug: string | null; avatarUrl: string | null } | null;
  // Date over the wire arrives as ISO string.
  createdAt: string;
};

const HINTS_QUERY_KEY = ["admin", "hints"] as const;

const fetchHints = async (): Promise<PendingHint[]> => {
  const res = await apiClient.api.admin.hints.$get();
  if (!res.ok) throw new Error(`admin/hints: ${res.status}`);
  const body = (await res.json()) as { hints: PendingHint[] };
  return body.hints;
};

export function AdminHints() {
  const queryClient = useQueryClient();
  const [relator, setRelator] = useState<MemberSummary | null>(null);
  const [relatee, setRelatee] = useState<MemberSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hintsQuery = useQuery({ queryKey: HINTS_QUERY_KEY, queryFn: fetchHints });

  const createMutation = useMutation({
    mutationFn: async (vars: { relatorId: string; relateeId: string }) => {
      const res = await apiClient.api.relations.hint.$post({ json: vars });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `relations/hint: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setRelator(null);
      setRelatee(null);
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: HINTS_QUERY_KEY });
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : "Failed to create hint.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (vars: { relatorId: string; relateeId: string }) => {
      const res = await apiClient.api.relations.hint[":relatorId"][":relateeId"].$delete({ param: vars });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `relations/hint DELETE: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HINTS_QUERY_KEY });
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : "Failed to withdraw hint.");
    },
  });

  const submit = () => {
    if (!relator || !relatee) return;
    if (relator.id === relatee.id) {
      setErrorMessage("Pick two different members.");
      return;
    }
    createMutation.mutate({ relatorId: relator.id, relateeId: relatee.id });
  };

  const submitDisabled = !relator || !relatee || createMutation.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded border border-border p-3">
        <p className="text-sm text-muted-foreground">
          Seed a hint that <em>relator</em> might know <em>target</em>. The hint surfaces on the relator's
          suggestion feed; they convert it by rating, or it stays pending.
        </p>
        <MemberTypeahead
          label="Relator (whose feed gets the hint)"
          triggerLabel="Pick a relator…"
          selectedLabel={relator?.displayName ?? null}
          selectedIds={[]}
          excludeIds={relatee ? [relatee.id] : []}
          onSelect={setRelator}
          disabled={createMutation.isPending}
        />
        <MemberTypeahead
          label="Target (the suggested member)"
          triggerLabel="Pick a target…"
          selectedLabel={relatee?.displayName ?? null}
          selectedIds={[]}
          excludeIds={relator ? [relator.id] : []}
          onSelect={setRelatee}
          disabled={createMutation.isPending}
        />
        <Button type="button" variant="secondary" disabled={submitDisabled} onClick={submit} className="self-start">
          {createMutation.isPending ? "Creating…" : "Create hint"}
        </Button>
        {errorMessage && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">Pending hints</h3>
        {hintsQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : hintsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn't load pending hints.
          </p>
        ) : hintsQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending hints.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {hintsQuery.data.map((h) => (
              <li
                key={`${h.relator.id}:${h.relatee.id}`}
                className="flex items-center gap-3 rounded border border-border p-2 text-sm"
              >
                <HintParty profile={h.relator} />
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
                <HintParty profile={h.relatee} />
                <span className="ml-auto text-xs text-muted-foreground">
                  {h.hintedBy?.displayName ? `by ${h.hintedBy.displayName}` : "by ?"}
                </span>
                <Button
                  type="button"
                  variant="destructive"
                  size="xs"
                  disabled={deleteMutation.isPending}
                  onClick={() =>
                    deleteMutation.mutate({ relatorId: h.relator.id, relateeId: h.relatee.id })
                  }
                >
                  Withdraw
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HintParty({ profile }: { profile: PendingHint["relator"] }) {
  return (
    <span className="flex items-center gap-1.5">
      <Avatar
        name={profile.displayName}
        url={profile.avatarUrl}
        className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[9px] font-semibold text-muted-foreground"
      />
      <span>{profile.displayName ?? "—"}</span>
    </span>
  );
}
