"use client";

import type { UrlObject } from "node:url";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Avatar } from "@/components/avatar";
import { LocalTime } from "@/components/local-time";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api";
import type { MessageBoxMessage, MessageBoxResponse } from "@/lib/api-types";
import { MESSAGE_BOX_MAX_LENGTH } from "@/lib/program-features";

import { MESSAGE_BOX_CARD_CLASSNAME } from "./message-box-card";
import { HYDRATED_STALE_TIME, messageBoxArchivedQueryKey, messageBoxQueryKey } from "./query-keys";

const fetchMessageBox = async (programId: string): Promise<MessageBoxResponse> => {
  const res = await apiClient.api.programs[":id"]["message-box"].$get({ param: { id: programId } });
  if (!res.ok) throw new Error(`programs/${programId}/message-box: ${res.status}`);
  return res.json();
};

const errorFrom = async (res: Response, fallback: string): Promise<string> => {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (body.error === "not_participant") return "Only participants of this program can leave a message.";
  if (body.error === "not_found") return "The message box isn't available right now.";
  return body.error ?? fallback;
};

// The message-box program feature: participants leave short messages; who can
// read them is a per-program admin setting; admins can delete.
export function MessageBox({ programId }: { programId: string }) {
  const query = useQuery({
    queryKey: messageBoxQueryKey(programId),
    queryFn: () => fetchMessageBox(programId),
    staleTime: HYDRATED_STALE_TIME,
  });

  return (
    <section className={MESSAGE_BOX_CARD_CLASSNAME} aria-labelledby="message-box-heading">
      <h3 id="message-box-heading" className="text-base font-semibold uppercase tracking-wide text-muted-foreground">
        Message box
      </h3>
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load the message box.
        </p>
      ) : (
        <MessageBoxBody programId={programId} data={query.data} />
      )}
    </section>
  );
}

function MessageBoxBody({ programId, data }: { programId: string; data: MessageBoxResponse }) {
  return (
    <>
      {data.prompt && <Markdown>{data.prompt}</Markdown>}
      {data.canPost ? (
        <MessageForm programId={programId} />
      ) : (
        <p className="text-sm text-muted-foreground">Join this program to leave a message.</p>
      )}
      {data.canRead ? (
        <MessageList
          programId={programId}
          messages={data.messages}
          canModerate={data.canModerate}
          canEdit={data.canPost}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Messages sent here are read by the program's admins.</p>
      )}
    </>
  );
}

function MessageForm({ programId }: { programId: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiClient.api.programs[":id"]["message-box"].$post({
        param: { id: programId },
        json: { body },
      });
      if (!res.ok) throw new Error(await errorFrom(res, "Couldn't send your message."));
      return res.json();
    },
    onSuccess: () => {
      setText("");
      queryClient.invalidateQueries({ queryKey: messageBoxQueryKey(programId) });
    },
  });

  const trimmed = text.trim();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed && !sendMutation.isPending) sendMutation.mutate(trimmed);
      }}
    >
      <Label htmlFor="message-box-text">Leave a message</Label>
      <Textarea
        id="message-box-text"
        value={text}
        maxLength={MESSAGE_BOX_MAX_LENGTH}
        rows={3}
        disabled={sendMutation.isPending}
        onChange={(e) => {
          setText(e.target.value);
          if (sendMutation.isSuccess || sendMutation.isError) sendMutation.reset();
        }}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={!trimmed || sendMutation.isPending}>
          {sendMutation.isPending ? "Sending…" : "Send"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {text.length}/{MESSAGE_BOX_MAX_LENGTH}
        </span>
        {sendMutation.isSuccess && (
          <span role="status" className="text-sm text-muted-foreground">
            Message sent.
          </span>
        )}
      </div>
      {sendMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {sendMutation.error.message}
        </p>
      )}
    </form>
  );
}

function MessageList({
  programId,
  messages,
  canModerate,
  canEdit,
}: {
  programId: string;
  messages: MessageBoxMessage[];
  canModerate: boolean;
  // The viewer may edit their own messages (they are a participant).
  canEdit: boolean;
}) {
  if (messages.length === 0) {
    return <p className="text-sm text-muted-foreground">No messages yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {messages.map((m) => (
        <MessageItem
          key={m.id}
          programId={programId}
          message={m}
          canModerate={canModerate}
          canEdit={canEdit && m.mine}
        />
      ))}
    </ul>
  );
}

function MessageItem({
  programId,
  message,
  canModerate,
  canEdit,
}: {
  programId: string;
  message: MessageBoxMessage;
  canModerate: boolean;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.api.admin.programs[":id"]["message-box"].messages[":messageId"].$delete({
        param: { id: programId, messageId: message.id },
      });
      if (!res.ok) throw new Error(await errorFrom(res, "Couldn't delete the message."));
      return res.json();
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: messageBoxQueryKey(programId) }),
        queryClient.invalidateQueries({ queryKey: messageBoxArchivedQueryKey(programId) }),
      ]),
    onSettled: () => setConfirming(false),
  });

  // Archiving is reversible (the message moves to the admin archive), so unlike
  // Delete it needs no confirmation.
  const archiveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.api.admin.programs[":id"]["message-box"].messages[":messageId"].$patch({
        param: { id: programId, messageId: message.id },
        json: { archived: true },
      });
      if (!res.ok) throw new Error(await errorFrom(res, "Couldn't archive the message."));
      return res.json();
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: messageBoxQueryKey(programId) }),
        queryClient.invalidateQueries({ queryKey: messageBoxArchivedQueryKey(programId) }),
      ]),
  });

  const href: UrlObject = { pathname: `/members/${message.author.slug ?? message.author.id}` };
  const moderationError = archiveMutation.error ?? deleteMutation.error;

  return (
    <li className="flex flex-col gap-1 rounded bg-background p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Avatar
          name={message.author.displayName}
          url={message.author.avatarUrl}
          className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
        />
        <Link href={href} className="whitespace-nowrap font-medium hover:underline">
          {message.author.displayName ?? "Member"}
        </Link>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          <LocalTime iso={message.createdAt} withTime />
        </span>
        {!editing && (canEdit || canModerate) && (
          <span className="ml-auto flex items-center gap-2">
            {canEdit && !confirming && (
              <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {canModerate && !confirming && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={archiveMutation.isPending}
                onClick={() => archiveMutation.mutate()}
              >
                {archiveMutation.isPending ? "Archiving…" : "Archive"}
              </Button>
            )}
            {canModerate &&
              (confirming ? (
                <>
                  <Button
                    type="button"
                    variant="destructive"
                    size="xs"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate()}
                  >
                    {deleteMutation.isPending ? "Deleting…" : "Confirm delete"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={deleteMutation.isPending}
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button type="button" variant="destructive" size="xs" onClick={() => setConfirming(true)}>
                  Delete
                </Button>
              ))}
          </span>
        )}
      </div>
      {editing ? (
        <EditForm programId={programId} message={message} onDone={() => setEditing(false)} />
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
      )}
      {moderationError && (
        <p role="alert" className="text-sm text-destructive">
          {moderationError.message}
        </p>
      )}
    </li>
  );
}

// Inline editor for the author's own message. No "edited" marker is kept; the
// message keeps its place in the list.
function EditForm({
  programId,
  message,
  onDone,
}: {
  programId: string;
  message: MessageBoxMessage;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(message.body);
  const trimmed = text.trim();

  const saveMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiClient.api.programs[":id"]["message-box"].messages[":messageId"].$patch({
        param: { id: programId, messageId: message.id },
        json: { body },
      });
      if (!res.ok) throw new Error(await errorFrom(res, "Couldn't save your changes."));
      return res.json();
    },
    // Wait for the refetch so the list shows the new text before the editor closes.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: messageBoxQueryKey(programId) });
      onDone();
    },
  });

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed && !saveMutation.isPending) saveMutation.mutate(trimmed);
      }}
    >
      <Textarea
        aria-label="Edit your message"
        value={text}
        maxLength={MESSAGE_BOX_MAX_LENGTH}
        rows={3}
        autoFocus
        disabled={saveMutation.isPending}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="secondary"
          size="xs"
          disabled={!trimmed || trimmed === message.body || saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={saveMutation.isPending} onClick={onDone}>
          Cancel
        </Button>
        <span className="text-xs text-muted-foreground">
          {text.length}/{MESSAGE_BOX_MAX_LENGTH}
        </span>
      </div>
      {saveMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {saveMutation.error.message}
        </p>
      )}
    </form>
  );
}
