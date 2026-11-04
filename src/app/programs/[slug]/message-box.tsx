"use client";

import type { UrlObject } from "node:url";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Avatar } from "@/components/avatar";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api";
import type { MessageBoxMessage, MessageBoxResponse } from "@/lib/api-types";
import { MESSAGE_BOX_MAX_LENGTH } from "@/lib/program-features";

import { HYDRATED_STALE_TIME, messageBoxQueryKey } from "./query-keys";

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
    <section className="flex flex-col gap-4" aria-labelledby="message-box-heading">
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
      {data.canPost ? (
        <MessageForm programId={programId} />
      ) : (
        <p className="text-sm text-muted-foreground">Join this program to leave a message.</p>
      )}
      {data.canRead ? (
        <MessageList programId={programId} messages={data.messages} canModerate={data.canModerate} />
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
}: {
  programId: string;
  messages: MessageBoxMessage[];
  canModerate: boolean;
}) {
  if (messages.length === 0) {
    return <p className="text-sm text-muted-foreground">No messages yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {messages.map((m) => (
        <MessageItem key={m.id} programId={programId} message={m} canModerate={canModerate} />
      ))}
    </ul>
  );
}

function MessageItem({
  programId,
  message,
  canModerate,
}: {
  programId: string;
  message: MessageBoxMessage;
  canModerate: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.api.admin.programs[":id"]["message-box"].messages[":messageId"].$delete({
        param: { id: programId, messageId: message.id },
      });
      if (!res.ok) throw new Error(await errorFrom(res, "Couldn't delete the message."));
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messageBoxQueryKey(programId) }),
    onSettled: () => setConfirming(false),
  });

  const href: UrlObject = { pathname: `/members/${message.author.slug ?? message.author.id}` };

  return (
    <li className="flex flex-col gap-1 rounded border border-border p-3">
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
        {canModerate &&
          (confirming ? (
            <span className="ml-auto flex items-center gap-2">
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
            </span>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="xs"
              className="ml-auto"
              onClick={() => setConfirming(true)}
            >
              Delete
            </Button>
          ))}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
      {deleteMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {deleteMutation.error.message}
        </p>
      )}
    </li>
  );
}
