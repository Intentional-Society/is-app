"use client";

import { useCallback, useEffect, useState } from "react";

import { MemberChip, MemberTypeahead } from "@/components/member-typeahead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api";
import type { Me, MemberSummary } from "@/lib/api-types";
import { formatDate } from "@/lib/format-date";
import { HINTS_PER_INVITE_LIMIT, MIN_NOTE_LENGTH } from "@/lib/invite-limits";
import {
  RELATION_VALUE_LABELS,
  RELATION_VALUE_VISIBILITY_NOTE,
  RELATION_VALUES,
  type RelationValue,
} from "@/lib/relation-value";
import { cn } from "@/lib/utils";

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
    if (trimmed.length < MIN_NOTE_LENGTH) {
      setState({
        kind: "error",
        message: `Please write at least ${MIN_NOTE_LENGTH} characters about who you're inviting.`,
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
        const body = (await res.json().catch(() => ({}))) as { limit?: number };
        const message = body.limit
          ? `You already have ${body.limit} active invites. Revoke one first.`
          : "You already have the maximum number of active invites. Revoke one first.";
        setState({ kind: "error", message });
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
      const link = `${window.location.origin}/signup?code=${code}`;
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
    if (hints.length >= HINTS_PER_INVITE_LIMIT) return;
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
        Invite a new member
      </h2>
      <p className="text-base text-muted-foreground">
        You can bring others into the IS Web — ideally people <em>already</em> woven into our larger network of
        relationships. If you're their only connection here, make it a strong one.
      </p>
      <form onSubmit={create} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-note">Who are you inviting? (We'll use this to greet them initially.)</Label>
          <Input
            id="invite-note"
            required
            minLength={MIN_NOTE_LENGTH}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={submitting}
          />
        </div>

        <RelationValuePicker value={relationValue} onChange={setRelationValue} disabled={submitting} />

        <div className="flex flex-col gap-2">
          <MemberTypeahead
            label="Recommendations: Who in this Web do you think they already know?"
            triggerLabel="Add a connection recommendation…"
            selectedIds={hints.map((h) => h.id)}
            excludeIds={excludeFromHints}
            onSelect={addHint}
            disabled={submitting || hints.length >= HINTS_PER_INVITE_LIMIT}
          />
          {hints.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {hints.map((h) => (
                <MemberChip key={h.id} member={h} onRemove={removeHint} disabled={submitting} />
              ))}
            </div>
          )}
          {hints.length >= HINTS_PER_INVITE_LIMIT && (
            <p className="text-sm text-muted-foreground">Up to {HINTS_PER_INVITE_LIMIT} hints per invite.</p>
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
        <h3 className="mb-2 text-base font-semibold text-muted-foreground">My Invites</h3>
        {rows === null ? (
          <p className="text-base text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-base text-muted-foreground">No invites yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.code}
                className="flex items-start justify-between gap-3 rounded-xl bg-popover p-3 text-base ring-1 ring-foreground/10"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-foreground">{row.note}</p>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={row.status} />
                    <span className="text-sm text-muted-foreground">Expires {formatDate(row.expiresAt)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="whitespace-nowrap text-base">
                    <span className="text-muted-foreground">Code: </span>
                    <code className="font-mono">{row.code}</code>
                  </div>
                  {row.status === "active" && (
                    <div className="flex gap-2">
                      <Button size="xs" onClick={() => copy(row.code)}>
                        {copiedCode === row.code ? "Copied" : "Copy invite link"}
                      </Button>
                      <Button variant="destructive" size="xs" onClick={() => revoke(row.code)}>
                        Revoke
                      </Button>
                    </div>
                  )}
                </div>
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
    <div className="flex flex-col gap-2">
      <p id="relation-value-heading" className="text-base font-medium leading-none">
        What's your relationship to them?
      </p>
      <fieldset
        className="flex flex-col gap-2 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10"
        disabled={disabled}
        aria-labelledby="relation-value-heading"
      >
        <div className="flex flex-col gap-2">
          {RELATION_VALUES.map((v) => {
            const { headline, detail } = RELATION_VALUE_LABELS[v];
            const selected = value === v;
            return (
              <Button
                key={v}
                type="button"
                variant={selected ? "secondary" : "primary"}
                className="h-auto justify-start gap-3 whitespace-normal px-3 py-2 text-left"
                onClick={() => onChange(selected ? null : v)}
                aria-pressed={selected}
              >
                <span className="text-lg font-bold tabular-nums">{v}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">{headline}</span>
                  {/* The selected value renders as `secondary` (teal fill),
                      where muted-foreground is unreadable; switch the detail
                      line to the on-fill color in that state — same fix as
                      relating-dialog.tsx. */}
                  <span className={cn("text-sm", selected ? "text-primary-foreground/80" : "text-muted-foreground")}>
                    {detail}
                  </span>
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
        <p className="text-xs text-muted-foreground">Notes: {RELATION_VALUE_VISIBILITY_NOTE}</p>
      </fieldset>
    </div>
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

function confirmRevoke(): boolean {
  // Intentionally a simple browser confirm — a real modal isn't worth
  // the weight for a low-frequency destructive action in a small app.
  return window.confirm("Revoke this invite? The link will stop working immediately.");
}
