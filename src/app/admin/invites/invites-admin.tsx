"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ConfirmButton } from "@/components/confirm-button";
import { apiClient } from "@/lib/api";
import type { AdminInvite } from "@/lib/api-types";
import { formatDate } from "@/lib/format-date";
import { useIdSet } from "@/lib/use-id-set";

const QUERY_KEY = ["admin", "invites"] as const;

const fetchInvites = async (): Promise<AdminInvite[]> => {
  const res = await apiClient.api.admin.invites.$get();
  if (!res.ok) throw new Error(`admin/invites: ${res.status}`);
  const body = await res.json();
  return body.invites;
};

export function InvitesAdmin() {
  const queryClient = useQueryClient();

  // Invites whose last delete failed. Each row's own request records its
  // failure, and the row shows the message until that invite is retried.
  const [failedIds, setFailed] = useIdSet();
  const invitesQuery = useQuery({ queryKey: QUERY_KEY, queryFn: fetchInvites });

  const deleteMutation = useMutation<string, Error, string>({
    mutationFn: async (id) => {
      const res = await apiClient.api.admin.invites[":id"].$delete({ param: { id } });
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
      return id;
    },
    // After a failure too: a failed delete often means the row is stale (another
    // admin got there first), and a retry would fail the same way. A failure is
    // not awaited, so the row reports it at once instead of waiting on a refetch
    // that, with the network down, retries for several seconds and fails as well.
    onSettled: (_id, error) => {
      const refetch = queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      return error ? undefined : refetch;
    },
  });

  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      {invitesQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : invitesQuery.data === undefined ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load invites.
        </p>
      ) : invitesQuery.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invites yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {invitesQuery.data.map((inv) => {
            const meta = [
              inv.creatorName ? `from ${inv.creatorName}` : "from (unknown)",
              // A redeemed invite always has a redeemer (DB-enforced), so
              // always show it — falling back to (unnamed) when that member
              // never set a display name, the same way the creator does.
              inv.status === "redeemed" ? `redeemed by ${inv.redeemerName ?? "(unnamed)"}` : null,
              formatDate(inv.createdAt),
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
                  {failedIds.has(inv.id) && (
                    <p role="alert" className="text-xs text-destructive">
                      Couldn't delete this invite. Try again.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Two-step delete guards an irreversible hard delete against a stray click. */}
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Confirm"
                    pendingLabel="Deleting…"
                    onConfirm={() => {
                      setFailed(inv.id, false);
                      return deleteMutation.mutateAsync(inv.id).then(
                        () => undefined,
                        () => setFailed(inv.id, true),
                      );
                    }}
                    size="sm"
                    triggerVariant="destructive"
                    cancelVariant="ghost"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
