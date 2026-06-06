"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { AdminInvite } from "@/lib/api-types";

const QUERY_KEY = ["admin", "invites"] as const;

const fetchInvites = async (): Promise<AdminInvite[]> => {
  const res = await apiClient.api.admin.invites.$get();
  if (!res.ok) throw new Error(`admin/invites: ${res.status}`);
  const body = await res.json();
  return body.invites;
};

const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString();

export function InvitesAdmin() {
  const queryClient = useQueryClient();
  // Two-step delete: the first click arms a row, the second confirms.
  // Guards an irreversible hard delete against a stray click.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const invitesQuery = useQuery({ queryKey: QUERY_KEY, queryFn: fetchInvites });

  const deleteMutation = useMutation<string, Error, string>({
    mutationFn: async (id) => {
      const res = await apiClient.api.admin.invites[":id"].$delete({ param: { id } });
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
      return id;
    },
    onSuccess: () => {
      setConfirmingId(null);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      {invitesQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : invitesQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load invites.
        </p>
      ) : invitesQuery.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invites yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {invitesQuery.data.map((inv) => {
            const isConfirming = confirmingId === inv.id;
            const isDeleting = deleteMutation.isPending && deleteMutation.variables === inv.id;
            const meta = [
              inv.creatorName ? `from ${inv.creatorName}` : "from (unknown)",
              // A redeemed invite always has a redeemer (DB-enforced), so
              // always show it — falling back to (unnamed) when that member
              // never set a display name, the same way the creator does.
              inv.status === "redeemed" ? `redeemed by ${inv.redeemerName ?? "(unnamed)"}` : null,
              fmtDate(inv.createdAt),
            ].filter(Boolean);

            return (
              <li key={inv.id} className="flex items-start gap-3 rounded border border-border p-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 break-words font-medium">{inv.note}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {inv.status}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {meta.join(" · ")} · <span className="font-mono">{inv.code}</span>
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {isConfirming ? (
                    <>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={isDeleting}
                        onClick={() => deleteMutation.mutate(inv.id)}
                      >
                        {isDeleting ? "Deleting…" : "Confirm"}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={isDeleting} onClick={() => setConfirmingId(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button variant="destructive" size="sm" onClick={() => setConfirmingId(inv.id)}>
                      Delete
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
