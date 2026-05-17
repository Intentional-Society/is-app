"use client";

import { useCallback, useEffect, useState } from "react";

import { MemberChip, MemberTypeahead } from "@/components/member-typeahead";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api";
import type { Me, MemberSummary } from "@/lib/api-types";
import { RELATION_VALUE_LABELS, RELATION_VALUES, type RelationValue } from "@/lib/relation-value";

type InviteRow = {
  code: string;
  note: string;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
  status: "active" | "redeemed" | "revoked" | "expired";
};

type PanelState = { kind: "idle" } | { kind: "creating" } | { kind: "error"; message: string };

const HINT_LIMIT = 10;

type HintMember = Pick<MemberSummary, "id" | "displayName">;

export function InvitesPanel({ me }: { me: Me }) {
  const [rows, setRows] = useState<InviteRow[] | null>(null);
  const [note, setNote] = useState("");
  const [relationValue, setRelationValue] = useState<RelationValue | null>(null);
  const [hints, setHints] = useState<HintMember[]>([]);
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
        json: {
          note: trimmed,
          relationValue,
          hints: hints.map((h) => h.id),
        },
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
      setRelationValue(null);
      setHints([]);
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
      const link = `${window.location.origin}/signup?invite=${code}`;
      await navigator.clipboard.writeText(link);
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

  const addHint = (m: MemberSummary) => {
    if (hints.length >= HINT_LIMIT) return;
    if (hints.some((h) => h.id === m.id)) return;
    setHints((prev) => [...prev, { id: m.id, displayName: m.displayName }]);
  };

  const removeHint = (id: string) => {
    setHints((prev) => prev.filter((h) => h.id !== id));
  };

  const submitting = state.kind === "creating";
  const excludeFromHints = [me.id, ...hints.map((h) => h.id)];

  return (
    <section
      aria-labelledby="invites-heading"
      className="flex w-full max-w-xl flex-col gap-4 rounded border border-border p-4"
    >
      <h2 id="invites-heading" className="text-lg font-semibold">
        Invite a member
      </h2>
      <form onSubmit={create} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-note">Note (for your records and theirs — who are you inviting?)</Label>
          <Textarea
            id="invite-note"
            required
            minLength={10}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={submitting}
          />
        </div>

        <RelationValuePicker value={relationValue} onChange={setRelationValue} disabled={submitting} />

        <div className="flex flex-col gap-2">
          <MemberTypeahead
            label="Hints (optional) — people you think they'll want to know"
            triggerLabel="Add a hint…"
            selectedIds={hints.map((h) => h.id)}
            excludeIds={excludeFromHints}
            onSelect={addHint}
            disabled={submitting || hints.length >= HINT_LIMIT}
          />
          {hints.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {hints.map((h) => (
                <MemberChip key={h.id} member={h} onRemove={removeHint} disabled={submitting} />
              ))}
            </div>
          )}
          {hints.length >= HINT_LIMIT && (
            <p className="text-sm text-muted-foreground">Up to {HINT_LIMIT} hints per invite.</p>
          )}
        </div>

        <Button type="submit" disabled={submitting} className="self-start">
          {submitting ? "Creating…" : "Create invite"}
        </Button>
        {state.kind === "error" && (
          <p role="alert" className="text-base text-destructive">
            {state.message}
          </p>
        )}
      </form>

      <div>
        <h3 className="mb-2 text-base font-semibold uppercase tracking-wide text-muted-foreground">My invites</h3>
        {rows === null ? (
          <p className="text-base text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-base text-muted-foreground">No invites yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.code} className="flex flex-col gap-1 rounded border border-border p-3 text-base">
                <div className="flex items-center gap-3">
                  <code className="font-mono text-base">{row.code}</code>
                  <StatusBadge status={row.status} />
                  {row.status === "active" && (
                    <>
                      <Button size="xs" className="ml-auto" onClick={() => copy(row.code)}>
                        {copiedCode === row.code ? "Copied" : "Copy"}
                      </Button>
                      <Button variant="destructive" size="xs" onClick={() => revoke(row.code)}>
                        Revoke
                      </Button>
                    </>
                  )}
                </div>
                <p className="text-foreground">{row.note}</p>
                <p className="text-sm text-muted-foreground">Expires {formatDate(row.expiresAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function RelationValuePicker({
  value,
  onChange,
  disabled,
}: {
  value: RelationValue | null;
  onChange: (next: RelationValue | null) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-base font-medium">Your relationship to them (optional)</legend>
      <div className="flex flex-col gap-2">
        {RELATION_VALUES.map((v) => {
          const { headline, detail } = RELATION_VALUE_LABELS[v];
          const selected = value === v;
          return (
            <Button
              key={v}
              type="button"
              variant={selected ? "secondary" : "primary"}
              className="h-auto justify-start gap-3 px-3 py-2 text-left"
              onClick={() => onChange(selected ? null : v)}
              aria-pressed={selected}
            >
              <span className="text-lg font-bold tabular-nums">{v}</span>
              <span className="flex flex-col">
                <span className="font-semibold">{headline}</span>
                <span className="text-sm text-muted-foreground">{detail}</span>
              </span>
            </Button>
          );
        })}
      </div>
      {value === 1 && (
        <p className="text-sm text-muted-foreground">
          Inviting people you've only met in group settings tends to lead to weak fit. Is this the right time?
        </p>
      )}
    </fieldset>
  );
}

function StatusBadge({ status }: { status: InviteRow["status"] }) {
  const tone: Record<InviteRow["status"], string> = {
    active: "text-success",
    redeemed: "text-primary",
    revoked: "text-muted-foreground",
    expired: "text-muted-foreground",
  };
  return <span className={`text-sm font-semibold uppercase tracking-wide ${tone[status]}`}>{status}</span>;
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
  return window.confirm("Revoke this invite? The link will stop working immediately.");
}
