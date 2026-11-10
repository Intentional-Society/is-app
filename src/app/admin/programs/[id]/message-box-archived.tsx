"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { messageBoxArchivedQueryKey, messageBoxQueryKey } from "@/app/programs/[slug]/query-keys";
import { Avatar } from "@/components/avatar";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { ArchivedMessageBoxMessage } from "@/lib/api-types";

const fetchArchived = async (programId: string): Promise<ArchivedMessageBoxMessage[]> => {
  const res = await apiClient.api.admin.programs[":id"]["message-box"].archived.$get({ param: { id: programId } });
  if (!res.ok) throw new Error(`admin/programs/${programId}/message-box/archived: ${res.status}`);
  return (await res.json()).messages;
};

// Messages an admin archived from the program page. They are hidden from
// members but kept in the database; from here an admin can restore one to the
// page or delete it for good.
export function ArchivedMessages({ programId }: { programId: string }) {
  const query = useQuery({
    queryKey: messageBoxArchivedQueryKey(programId),
    queryFn: () => fetchArchived(programId),
  });

  const count = query.data?.length;

  return (
    <details className="rounded border border-border p-2">
      <summary className="cursor-pointer text-sm font-medium">
        Archived messages{count !== undefined ? ` (${count})` : ""}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Hidden from the program page for everyone. Restore puts a message back; Delete removes it permanently.
        </p>
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn't load archived messages.
          </p>
        ) : query.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No archived messages.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {query.data.map((m) => (
              <ArchivedItem key={m.id} programId={programId} message={m} />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function ArchivedItem({ programId, message }: { programId: string; message: ArchivedMessageBoxMessage }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  // Restoring changes what the program page shows; deleting only changes this list.
  const refresh = (alsoProgramPage: boolean) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: messageBoxArchivedQueryKey(programId) }),
      alsoProgramPage ? queryClient.invalidateQueries({ queryKey: messageBoxQueryKey(programId) }) : undefined,
    ]);

  const route = apiClient.api.admin.programs[":id"]["message-box"].messages[":messageId"];
  const param = { id: programId, messageId: message.id };

  const restoreMutation = useMutation({
    mutationFn: async () => {
      const res = await route.$patch({ param, json: { archived: false } });
      if (!res.ok) throw new Error("Couldn't restore the message.");
      return res.json();
    },
    onSuccess: () => refresh(true),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await route.$delete({ param });
      if (!res.ok) throw new Error("Couldn't delete the message.");
      return res.json();
    },
    onSuccess: () => refresh(false),
    onSettled: () => setConfirming(false),
  });

  const busy = restoreMutation.isPending || deleteMutation.isPending;
  const error = restoreMutation.error ?? deleteMutation.error;

  return (
    <li className="flex flex-col gap-1 rounded bg-background p-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Avatar
          name={message.author.displayName}
          url={message.author.avatarUrl}
          className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
        />
        <span className="font-medium">{message.author.displayName ?? "Member"}</span>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          sent <LocalTime iso={message.createdAt} withTime /> · archived <LocalTime iso={message.archivedAt} withTime />
        </span>
        <span className="ml-auto flex items-center gap-2">
          {confirming ? (
            <>
              <Button
                type="button"
                variant="destructive"
                size="xs"
                disabled={busy}
                onClick={() => deleteMutation.mutate()}
              >
                {deleteMutation.isPending ? "Deleting…" : "Confirm delete"}
              </Button>
              <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="primary"
                size="xs"
                disabled={busy}
                onClick={() => restoreMutation.mutate()}
              >
                {restoreMutation.isPending ? "Restoring…" : "Restore"}
              </Button>
              <Button type="button" variant="destructive" size="xs" disabled={busy} onClick={() => setConfirming(true)}>
                Delete
              </Button>
            </>
          )}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words">{message.body}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
    </li>
  );
}
