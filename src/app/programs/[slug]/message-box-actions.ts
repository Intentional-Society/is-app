import type { QueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api";
import { errorFrom, MESSAGE_GONE } from "@/lib/message-box-errors";

import { messageBoxArchivedQueryKey, messageBoxQueryKey } from "./query-keys";

// The admin moderation calls and cache refreshes for the message box, shared by
// the program page and the admin archive list so both behave (and report
// failures) the same way.

// Archive (hide, reversible) or restore a message. Throws with a readable
// message on failure.
export const patchArchived = async (programId: string, messageId: string, archived: boolean) => {
  const res = await apiClient.api.admin.programs[":id"]["message-box"].messages[":messageId"].$patch({
    param: { id: programId, messageId },
    json: { archived },
  });
  if (!res.ok) {
    throw new Error(
      await errorFrom(res, archived ? "Couldn't archive the message." : "Couldn't restore the message.", MESSAGE_GONE),
    );
  }
};

// Permanent delete. The server only deletes a message that is archived.
export const deleteForever = async (programId: string, messageId: string) => {
  const res = await apiClient.api.admin.programs[":id"]["message-box"].messages[":messageId"].$delete({
    param: { id: programId, messageId },
  });
  if (!res.ok) throw new Error(await errorFrom(res, "Couldn't delete the message.", MESSAGE_GONE));
};

// Hiding, restoring or deleting a message changes both lists.
export const refreshMessageBox = (queryClient: QueryClient, programId: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: messageBoxQueryKey(programId) }),
    queryClient.invalidateQueries({ queryKey: messageBoxArchivedQueryKey(programId) }),
  ]);

// Deleting an archived message only changes the archive list.
export const refreshArchive = (queryClient: QueryClient, programId: string) =>
  queryClient.invalidateQueries({ queryKey: messageBoxArchivedQueryKey(programId) });
