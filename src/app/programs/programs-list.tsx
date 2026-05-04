"use client";

import { useEffect, useState } from "react";

import { apiClient } from "@/lib/api";
import type { Program } from "@/lib/api-types";

type ListState =
  | { kind: "loading" }
  | { kind: "loaded"; programs: Program[] }
  | { kind: "error"; message: string };

export function ProgramsList() {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
        if (!cancelled) {
          setState({ kind: "error", message: "Network error loading programs." });
        }
      }
    }
    void fetchPrograms();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const join = async (programId: string) => {
    setPendingId(programId);
    setActionError(null);
    try {
      const res = await apiClient.api.programs[":id"].join.$post({
        param: { id: programId },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(body.error === "already_joined" ? "You've already joined this program." : "Failed to join program.");
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
      const res = await apiClient.api.programs[":id"].leave.$post({
        param: { id: programId },
      });
      if (!res.ok) {
        setActionError("Failed to leave program.");
      }
      reload();
    } catch {
      setActionError("Network error leaving program.");
    } finally {
      setPendingId(null);
    }
  };

  if (state.kind === "loading") {
    return <p className="text-sm text-gray-400">Loading programs…</p>;
  }

  if (state.kind === "error") {
    return <p role="alert" className="text-sm text-red-300">{state.message}</p>;
  }

  if (state.programs.length === 0) {
    return <p className="text-sm text-gray-400">No programs available yet.</p>;
  }

  return (
    <>
      {actionError && (
        <p role="alert" className="w-full max-w-xl text-sm text-red-300">
          {actionError}
        </p>
      )}
      <ul className="flex w-full max-w-xl flex-col gap-4">
      {state.programs.map((program) => (
        <li
          key={program.id}
          className="flex flex-col gap-2 rounded border border-gray-700 p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">{program.name}</h2>
              {program.description && (
                <p className="font-serif text-sm text-gray-500">
                  {program.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {program.memberCount} {program.memberCount === 1 ? "member" : "members"}
            </span>
            {program.joined ? (
              <button
                type="button"
                disabled={pendingId === program.id}
                onClick={() => leave(program.id)}
                className="rounded border border-red-500/40 px-3 py-1 text-sm text-red-300 disabled:opacity-50"
              >
                {pendingId === program.id ? "Leaving…" : "Leave"}
              </button>
            ) : (
              <button
                type="button"
                disabled={pendingId === program.id}
                onClick={() => join(program.id)}
                className="rounded bg-gray-100 px-3 py-1 text-sm font-medium text-gray-900 disabled:opacity-50"
              >
                {pendingId === program.id ? "Joining…" : "Join"}
              </button>
            )}
          </div>
          {program.joined && program.joinedAt && (
            <p className="text-xs text-gray-500">
              Joined {formatDate(program.joinedAt)}
            </p>
          )}
        </li>
      ))}
    </ul>
    </>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
