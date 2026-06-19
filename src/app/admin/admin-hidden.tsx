"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Avatar } from "@/components/avatar";
import { MemberTypeahead } from "@/components/member-typeahead";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { MemberSummary } from "@/lib/api-types";

const HIDDEN_QUERY_KEY = ["admin", "hidden"] as const;
const MEMBERS_QUERY_KEY = ["members"] as const;

const fetchHidden = async (): Promise<MemberSummary[]> => {
  const res = await apiClient.api.admin.profiles.hidden.$get();
  if (!res.ok) throw new Error(`admin/profiles/hidden: ${res.status}`);
  const body = await res.json();
  return body.members;
};

export function AdminHidden() {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<MemberSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hiddenQuery = useQuery({ queryKey: HIDDEN_QUERY_KEY, queryFn: fetchHidden });

  const hiddenIds = useMemo(() => (hiddenQuery.data ?? []).map((m) => m.id), [hiddenQuery.data]);

  const toggleMutation = useMutation({
    mutationFn: async (vars: { id: string; hidden: boolean }) => {
      const res = await apiClient.api.admin.profiles[":id"].$patch({
        param: { id: vars.id },
        json: { hidden: vars.hidden },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `admin/profiles PATCH: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setPicked(null);
      setErrorMessage(null);
      // The members typeahead and the directory both depend on the
      // hidden flag, so invalidate both alongside the hidden list.
      queryClient.invalidateQueries({ queryKey: HIDDEN_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEY });
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : "Failed to update hidden state.");
    },
  });

  const hide = () => {
    if (!picked) return;
    toggleMutation.mutate({ id: picked.id, hidden: true });
  };

  const submitDisabled = !picked || toggleMutation.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded border border-border p-3">
        <p className="text-sm text-muted-foreground">
          Hide an account so it stops showing up in the directory, the web, and the suggestion feed — for everyone,
          admins included. Hidden accounts surface only here and on the admin members page.
        </p>
        <MemberTypeahead
          label="Account to hide"
          triggerLabel="Pick a member…"
          selectedLabel={picked?.displayName ?? null}
          selectedIds={hiddenIds}
          onSelect={setPicked}
          disabled={toggleMutation.isPending}
        />
        <Button type="button" variant="secondary" disabled={submitDisabled} onClick={hide} className="self-start">
          {toggleMutation.isPending ? "Hiding…" : "Hide"}
        </Button>
        {errorMessage && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">Hidden accounts</h3>
        {hiddenQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : hiddenQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn't load hidden accounts.
          </p>
        ) : hiddenQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hidden accounts.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {hiddenQuery.data.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded border border-border p-2 text-sm">
                <Avatar
                  name={m.displayName}
                  url={m.avatarUrl}
                  className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
                />
                <span>{m.displayName ?? "—"}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="ml-auto"
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate({ id: m.id, hidden: false })}
                >
                  Unhide
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
