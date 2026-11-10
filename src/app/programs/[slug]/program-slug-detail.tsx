"use client";

import type { UrlObject } from "node:url";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/avatar";
import { LocalTime } from "@/components/local-time";
import { Markdown, MarkdownInline } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { ProgramDetail } from "@/lib/api-types";

import { HYDRATED_STALE_TIME, messageBoxQueryKey, programQueryKey } from "./query-keys";

const fetchProgram = async (slug: string): Promise<ProgramDetail> => {
  const res = await apiClient.api.programs["by-slug"][":slug"].$get({ param: { slug } });
  // 404 is a final answer (archived or unknown), not a transient failure.
  if (res.status === 404) throw new Error("not_found");
  if (!res.ok) throw new Error(`programs/by-slug/${slug}: ${res.status}`);
  const body = await res.json();
  return body.program;
};

// `children` are the program-feature sections the server page renders (each an
// async Server Component in its own <Suspense>). They show between the join
// controls and the member list, once the program has loaded.
export function ProgramSlugDetail({ slug, children }: { slug: string; children?: ReactNode }) {
  const query = useQuery({
    queryKey: programQueryKey(slug),
    queryFn: () => fetchProgram(slug),
    retry: false,
    // The server page seeds this key; without a staleTime the app-wide default
    // of 0 would refetch on mount and throw the seed away.
    staleTime: HYDRATED_STALE_TIME,
  });

  // Once the program has loaded, a failed background refetch must not replace the
  // page with an error: that would unmount the feature sections (and any Undo
  // still counting down inside them). Keep showing the last good data.
  if (!query.data) {
    if (query.isPending) {
      return <p className="w-full max-w-3xl text-sm text-muted-foreground">Loading…</p>;
    }
    const missing = query.error instanceof Error && query.error.message === "not_found";
    return (
      <p role="alert" className="w-full max-w-3xl text-sm text-destructive">
        {missing ? "Program not found." : "Couldn't load this program."}
      </p>
    );
  }

  return <ProgramBody program={query.data}>{children}</ProgramBody>;
}

function ProgramBody({ program, children }: { program: ProgramDetail; children?: ReactNode }) {
  const queryClient = useQueryClient();
  // Joining or leaving changes whether the viewer can post to a feature's box.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: programQueryKey(program.slug) });
    queryClient.invalidateQueries({ queryKey: messageBoxQueryKey(program.id) });
  };

  const joinMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.api.programs[":id"].join.$post({ param: { id: program.id } });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error === "signups_closed"
            ? "Signups for this program are closed."
            : body.error === "already_joined"
              ? "You've already joined this program."
              : "Failed to join program.",
        );
      }
      return res.json();
    },
    onSuccess: invalidate,
  });

  const leaveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.api.programs[":id"].leave.$post({ param: { id: program.id } });
      if (!res.ok) throw new Error("Failed to leave program.");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const actionError =
    joinMutation.error instanceof Error
      ? joinMutation.error.message
      : leaveMutation.error instanceof Error
        ? leaveMutation.error.message
        : null;
  const pending = joinMutation.isPending || leaveMutation.isPending;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-3xl font-semibold">{program.name}</h2>
        {program.blurb && (
          <MarkdownInline className="font-serif text-base text-muted-foreground">{program.blurb}</MarkdownInline>
        )}
        <p className="text-xs text-muted-foreground">
          {program.memberCount} {program.memberCount === 1 ? "member" : "members"}
          {program.joined && program.joinedAt && (
            <>
              {" "}
              · Joined <LocalTime iso={program.joinedAt} />
            </>
          )}
        </p>
      </header>

      {program.description && <Markdown>{program.description}</Markdown>}

      <div className="flex items-center gap-3">
        {program.joined ? (
          <Button type="button" variant="primary" disabled={pending} onClick={() => leaveMutation.mutate()}>
            {leaveMutation.isPending ? "Leaving…" : "Leave program"}
          </Button>
        ) : program.signupsOpen ? (
          <Button type="button" disabled={pending} onClick={() => joinMutation.mutate()}>
            {joinMutation.isPending ? "Joining…" : "Join program"}
          </Button>
        ) : (
          <Button type="button" disabled>
            Signups closed
          </Button>
        )}
      </div>
      {actionError && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}

      {children}

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">
          Members ({program.members.length})
        </h3>
        {program.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one's joined yet.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {program.members.map((m) => {
              const href: UrlObject = { pathname: `/members/${m.slug ?? m.id}` };
              return (
                <li key={m.id}>
                  <Link
                    href={href}
                    className="flex items-center gap-3 rounded border border-border p-2 text-sm hover:bg-muted/50"
                  >
                    <Avatar
                      name={m.displayName}
                      url={m.avatarUrl}
                      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                    />
                    <span>{m.displayName ?? "—"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
