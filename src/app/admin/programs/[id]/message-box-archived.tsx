"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  deleteForever,
  patchArchived,
  refreshArchive,
  refreshMessageBox,
} from "@/app/programs/[slug]/message-box-actions";
import { messageBoxArchivedQueryKey } from "@/app/programs/[slug]/query-keys";
import { Avatar } from "@/components/avatar";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { UndoNotices } from "@/components/undo-notices";
import { apiClient } from "@/lib/api";
import type { ArchivedMessageBoxMessage } from "@/lib/api-types";
import { useUndoQueue } from "@/lib/use-undo-queue";

// Thrown for a 404: the viewer isn't allowed the archive (the seeded e2e admin
// is capped from it), which is not a failure worth an error alert.
const NOT_AVAILABLE = "not_available";

const fetchArchived = async (programId: string): Promise<ArchivedMessageBoxMessage[]> => {
  const res = await apiClient.api.admin.programs[":id"]["message-box"].archived.$get({ param: { id: programId } });
  if (res.status === 404) throw new Error(NOT_AVAILABLE);
  if (!res.ok) throw new Error(`admin/programs/${programId}/message-box/archived: ${res.status}`);
  return (await res.json()).messages;
};

// Messages an admin archived from the program page. They are hidden from
// members but kept in the database; from here an admin can restore one to the
// page or delete it for good. Delete waits out a 30-second Undo window before it
// actually deletes (leaving the page in that window leaves the message
// archived, never half-deleted).
export function ArchivedMessages({ programId }: { programId: string }) {
  const queryClient = useQueryClient();
  const undoQueue = useUndoQueue();
  // Restore failures are reported here, not in the row: the failed restore also
  // refreshes the list, which removes the row (and anything shown inside it).
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: messageBoxArchivedQueryKey(programId),
    queryFn: () => fetchArchived(programId),
    retry: false,
  });

  // Rows that were deleted from the screen but not yet on the server: waiting
  // out the Undo window, then until the real delete and the refetch finish, so a
  // row never flickers back in between.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const setIsHidden = (id: string, value: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  const visible = query.data?.filter((m) => !hidden.has(m.id));
  const count = visible?.length;

  const scheduleDelete = (message: ArchivedMessageBoxMessage) => {
    setRestoreError(null);
    setIsHidden(message.id, true);
    undoQueue.add({
      id: message.id,
      message: `Deleting ${message.author.displayName ?? "a member"}'s message.`,
      // Nothing was changed on the server yet, so undoing just brings the row back.
      onUndo: () => setIsHidden(message.id, false),
      onExpire: async () => {
        try {
          await deleteForever(programId, message.id);
        } finally {
          // Sync with the server whether the delete worked or the message was already gone.
          await refreshArchive(queryClient, programId);
          setIsHidden(message.id, false);
        }
      },
    });
  };

  if (query.error?.message === NOT_AVAILABLE) return null;

  return (
    <details className="rounded border border-border p-2">
      <summary className="cursor-pointer text-sm font-medium">
        Archived messages{count !== undefined ? ` (${count})` : ""}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Hidden from the program page for everyone. Restore puts a message back in the box at its original date; Delete
          removes it permanently after 30 seconds, unless you undo.
        </p>
        <UndoNotices entries={undoQueue.entries} onUndo={(id) => void undoQueue.undo(id)} />
        {(restoreError ?? undoQueue.error) && (
          <p role="alert" className="text-sm text-destructive">
            {restoreError ?? undoQueue.error}
          </p>
        )}
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn't load archived messages.
          </p>
        ) : visible && visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No archived messages.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible?.map((m) => (
              <ArchivedItem
                key={m.id}
                programId={programId}
                message={m}
                onDelete={() => scheduleDelete(m)}
                onRestoreResult={setRestoreError}
              />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function ArchivedItem({
  programId,
  message,
  onDelete,
  onRestoreResult,
}: {
  programId: string;
  message: ArchivedMessageBoxMessage;
  onDelete: () => void;
  // Called with the error text when a restore fails, or null when one starts.
  onRestoreResult: (error: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const restoreMutation = useMutation({
    mutationFn: () => {
      onRestoreResult(null);
      return patchArchived(programId, message.id, false);
    },
    // Restoring changes what the program page shows too. On failure (say another
    // admin already deleted it) refresh the list so a stale row goes away.
    onSuccess: () => refreshMessageBox(queryClient, programId),
    onError: (error) => {
      onRestoreResult(error.message);
      return refreshArchive(queryClient, programId);
    },
  });

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
              <Button type="button" variant="destructive" size="xs" onClick={onDelete}>
                Confirm delete
              </Button>
              <Button type="button" variant="ghost" size="xs" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="primary"
                size="xs"
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate()}
              >
                {restoreMutation.isPending ? "Restoring…" : "Restore"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="xs"
                disabled={restoreMutation.isPending}
                onClick={() => setConfirming(true)}
              >
                Delete
              </Button>
            </>
          )}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words">{message.body}</p>
    </li>
  );
}
