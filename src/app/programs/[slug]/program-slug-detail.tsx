"use client";

import type { UrlObject } from "node:url";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { ProgramDetail } from "@/lib/api-types";
import { formatDate } from "@/lib/format-date";

const programQueryKey = (slug: string) => ["programs", "by-slug", slug] as const;

const fetchProgram = async (slug: string): Promise<ProgramDetail> => {
  const res = await apiClient.api.programs["by-slug"][":slug"].$get({ param: { slug } });
  // 404 is a final answer (archived or unknown), not a transient failure.
  if (res.status === 404) throw new Error("not_found");
  if (!res.ok) throw new Error(`programs/by-slug/${slug}: ${res.status}`);
  const body = await res.json();
  return body.program;
};

export function ProgramSlugDetail({ slug }: { slug: string }) {
  const query = useQuery({
    queryKey: programQueryKey(slug),
    queryFn: () => fetchProgram(slug),
    retry: false,
  });

  if (query.isPending) {
    return <p className="w-full max-w-3xl text-sm text-muted-foreground">Loading…</p>;
  }
  if (query.isError) {
    const missing = query.error instanceof Error && query.error.message === "not_found";
    return (
      <p role="alert" className="w-full max-w-3xl text-sm text-destructive">
        {missing ? "Program not found." : "Couldn't load this program."}
      </p>
    );
  }

  return <ProgramBody program={query.data} />;
}

function ProgramBody({ program }: { program: ProgramDetail }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: programQueryKey(program.slug) });

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
        <p className="text-xs text-muted-foreground">
          {program.memberCount} {program.memberCount === 1 ? "member" : "members"}
          {program.joined && program.joinedAt && <> · Joined {formatDate(program.joinedAt)}</>}
        </p>
      </header>

      {program.description && (
        <p className="font-serif text-base text-muted-foreground leading-relaxed">{program.description}</p>
      )}

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
