"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";

// Nested under the program-detail key on purpose: invalidating
// ["admin", "programs", id] after an add/remove also refreshes this list
// (TanStack invalidation is prefix-matched), so the box stays in sync.
const queryKey = (programId: string) => ["admin", "programs", programId, "participant-emails"] as const;
const STALE_TIME = 5 * 60 * 1000;

const fetchEmails = async (programId: string): Promise<string[]> => {
  const res = await apiClient.api.admin.programs[":id"]["participant-emails"].$get({ param: { id: programId } });
  if (!res.ok) throw new Error(`admin/programs/${programId}/participant-emails: ${res.status}`);
  const body = await res.json();
  return body.emails;
};

export function ProgramEmailsPanel({ programId }: { programId: string }) {
  const emailsQuery = useQuery({
    queryKey: queryKey(programId),
    queryFn: () => fetchEmails(programId),
    staleTime: STALE_TIME,
  });
  const [copied, setCopied] = useState(false);

  if (emailsQuery.isPending) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (emailsQuery.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn't load email addresses.
      </p>
    );
  }

  if (emailsQuery.data.length === 0) {
    // Participants can exist while this is empty — hidden, deactivated,
    // and e2e accounts are filtered out server-side.
    return (
      <p className="text-sm text-muted-foreground">
        No mailable participants — hidden, deactivated, and e2e test accounts are excluded.
      </p>
    );
  }

  // Comma+space separation so the whole box pastes cleanly into Google
  // Calendar's guest field.
  const list = emailsQuery.data.join(", ");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(list);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API is available in all supported browsers. If a user
      // manages to hit this, the addresses are still in the box — they
      // can select and copy by hand.
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {emailsQuery.data.length} mailable participant{emailsQuery.data.length === 1 ? "" : "s"} — hidden, deactivated,
        and e2e test accounts are excluded.
      </p>
      <textarea
        readOnly
        value={list}
        rows={5}
        aria-label="Participant email addresses"
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded border border-border bg-muted/50 p-3 text-xs"
      />
      <Button size="sm" className="self-start" onClick={copy}>
        {copied ? "Copied" : "Copy all"}
      </Button>
    </div>
  );
}
