"use client";

import type { UrlObject } from "node:url";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { Program } from "@/lib/api-types";

type ListState = { kind: "loading" } | { kind: "loaded"; programs: Program[] } | { kind: "error"; message: string };

function ProgramCard({
  program,
  onJoin,
  onLeave,
  pending,
}: {
  program: Program;
  onJoin: (id: string) => void;
  onLeave: (id: string) => void;
  pending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const DESCRIPTION_LIMIT = 120;
  const description = program.description ?? "";
  const isLong = description.length > DESCRIPTION_LIMIT;
  const visibleDescription = isLong && !expanded ? `${description.slice(0, DESCRIPTION_LIMIT)}…` : description;

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">
          <Link
            href={{ pathname: `/programs/${program.slug}` } satisfies UrlObject}
            className="hover:underline focus-visible:underline"
          >
            {program.name}
          </Link>
        </h2>
        <p className="text-xs text-muted-foreground">
          {program.memberCount} {program.memberCount === 1 ? "member" : "members"}
          {program.joined && program.joinedAt && <> · Joined {formatDate(program.joinedAt)}</>}
        </p>
      </div>

      {description && (
        <div className="flex flex-col gap-1">
          <p className="font-serif text-sm text-muted-foreground leading-relaxed">{visibleDescription}</p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="self-start text-xs text-muted-foreground underline hover:no-underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      <div className="mt-auto pt-2">
        {program.joined ? (
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            onClick={() => onLeave(program.id)}
            className="w-full"
          >
            {pending ? "Leaving…" : "Leave program"}
          </Button>
        ) : program.signupsOpen ? (
          <Button type="button" disabled={pending} onClick={() => onJoin(program.id)} className="w-full">
            {pending ? "Joining…" : "Join program"}
          </Button>
        ) : (
          // Self-serve join is gated by signupsOpen — an admin can still
          // add a member directly, but the button stays out of reach.
          <Button type="button" disabled className="w-full">
            Signups closed
          </Button>
        )}
      </div>
    </li>
  );
}

export function ProgramsList() {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is a manual refetch trigger; bumping it reruns the effect by design
  useEffect(() => {
    let cancelled = false;
    async function fetchPrograms() {
      try {
        const res = await apiClient.api.programs.$get();
        if (cancelled) return;
        if (!res.ok) {
          setState({ kind: "error", message: `Failed to load programs (${res.status}).` });
          return;
        }
        const body = await res.json();
        setState({ kind: "loaded", programs: body.programs });
      } catch {
        if (!cancelled) setState({ kind: "error", message: "Network error loading programs." });
      }
    }
    void fetchPrograms();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const join = async (programId: string) => {
    setPendingId(programId);
    setActionError(null);
    try {
      const res = await apiClient.api.programs[":id"].join.$post({ param: { id: programId } });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(
          body.error === "already_joined"
            ? "You've already joined this program."
            : body.error === "signups_closed"
              ? "Signups for this program are closed."
              : "Failed to join program.",
        );
      }
      reload();
    } catch {
      setActionError("Network error joining program.");
    } finally {
      setPendingId(null);
    }
  };

  const leave = async (programId: string) => {
    setPendingId(programId);
    setActionError(null);
    try {
      const res = await apiClient.api.programs[":id"].leave.$post({ param: { id: programId } });
      if (!res.ok) setActionError("Failed to leave program.");
      reload();
    } catch {
      setActionError("Network error leaving program.");
    } finally {
      setPendingId(null);
    }
  };

  if (state.kind === "loading") return <p className="text-sm text-muted-foreground">Loading programs…</p>;
  if (state.kind === "error")
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.message}
      </p>
    );
  if (state.programs.length === 0) return <p className="text-sm text-muted-foreground">No programs available yet.</p>;

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      {actionError && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}
      <ul className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {state.programs.map((program) => (
          <ProgramCard
            key={program.id}
            program={program}
            onJoin={join}
            onLeave={leave}
            pending={pendingId === program.id}
          />
        ))}
      </ul>
    </div>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
