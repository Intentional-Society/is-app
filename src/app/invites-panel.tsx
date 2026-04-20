"use client";

import { useCallback, useEffect, useState } from "react";

import { apiClient } from "@/lib/api";

type InviteRow = {
  code: string;
  note: string;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
  status: "active" | "redeemed" | "revoked" | "expired";
};

type PanelState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "error"; message: string };

export function InvitesPanel() {
  const [rows, setRows] = useState<InviteRow[] | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await apiClient.api.invites.mine.$get();
      if (!res.ok) {
        setState({
          kind: "error",
          message: `Couldn't load invites (${res.status}).`,
        });
        return;
      }
      const body = await res.json();
      setRows(body.invites as InviteRow[]);
    } catch {
      setState({ kind: "error", message: "Network error loading invites." });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length < 10) {
      setState({
        kind: "error",
        message: "Note must be at least 10 characters.",
      });
      return;
    }
    setState({ kind: "creating" });
    try {
      const res = await apiClient.api.invites.$post({
        json: { note: trimmed },
      });
      if (res.status === 429) {
        setState({
          kind: "error",
          message: "You already have 10 active invites. Revoke one first.",
        });
        return;
      }
      if (!res.ok) {
        setState({
          kind: "error",
          message: `Couldn't create invite (${res.status}).`,
        });
        return;
      }
      setNote("");
      setState({ kind: "idle" });
      await reload();
    } catch {
      setState({ kind: "error", message: "Network error creating invite." });
    }
  };

  const revoke = async (code: string) => {
    if (!confirmRevoke()) return;
    try {
      const res = await apiClient.api.invites[":code"].revoke.$post({
        param: { code },
      });
      if (!res.ok) {
        setState({
          kind: "error",
          message: `Couldn't revoke invite (${res.status}).`,
        });
        return;
      }
      await reload();
    } catch {
      setState({ kind: "error", message: "Network error revoking invite." });
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => {
        setCopiedCode((c) => (c === code ? null : c));
      }, 2000);
    } catch {
      // Clipboard API is available in all supported browsers. If a
      // user manages to hit this, the code is still visible on the
      // page — they can select and copy by hand.
    }
  };

  return (
    <section
      aria-labelledby="invites-heading"
      className="flex w-full max-w-xl flex-col gap-4 rounded border border-gray-700 p-4"
    >
      <h2 id="invites-heading" className="text-lg font-semibold">
        Invite a member
      </h2>
      <form onSubmit={create} className="flex flex-col gap-2">
        <label htmlFor="invite-note" className="text-sm text-gray-300">
          Note (for your records and theirs — who are you inviting?)
        </label>
        <textarea
          id="invite-note"
          required
          minLength={10}
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={state.kind === "creating"}
          className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
        />
        <button
          type="submit"
          disabled={state.kind === "creating"}
          className="self-start rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
        >
          {state.kind === "creating" ? "Creating…" : "Create invite"}
        </button>
        {state.kind === "error" && (
          <p role="alert" className="text-sm text-red-300">
            {state.message}
          </p>
        )}
      </form>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
          My invites
        </h3>
        {rows === null ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400">No invites yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.code}
                className="flex flex-col gap-1 rounded border border-gray-800 p-3 text-sm"
              >
                <div className="flex items-center gap-3">
                  <code className="font-mono text-base">{row.code}</code>
                  <StatusBadge status={row.status} />
                  {row.status === "active" && (
                    <>
                      <button
                        type="button"
                        onClick={() => copy(row.code)}
                        className="ml-auto rounded border border-gray-600 px-2 py-1 text-xs"
                      >
                        {copiedCode === row.code ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        onClick={() => revoke(row.code)}
                        className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300"
                      >
                        Revoke
                      </button>
                    </>
                  )}
                </div>
                <p className="text-gray-300">{row.note}</p>
                <p className="text-xs text-gray-500">
                  Expires {formatDate(row.expiresAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: InviteRow["status"] }) {
  const tone: Record<InviteRow["status"], string> = {
    active: "border-green-500/40 text-green-300",
    redeemed: "border-blue-500/40 text-blue-300",
    revoked: "border-gray-500/40 text-gray-400",
    expired: "border-gray-500/40 text-gray-400",
  };
  return (
    <span
      className={`rounded border px-2 py-0.5 text-xs uppercase tracking-wide ${tone[status]}`}
    >
      {status}
    </span>
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

function confirmRevoke(): boolean {
  // Intentionally a simple browser confirm — a real modal isn't worth
  // the weight for a low-frequency destructive action in a small app.
  return window.confirm(
    "Revoke this invite? The link will stop working immediately.",
  );
}
