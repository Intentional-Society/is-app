"use client";

import { useCallback, useState } from "react";

import { apiClient } from "@/lib/api";
import type { AdminMember } from "@/lib/api-types";
import { Button } from "@/components/ui/button";

type ToggleState = { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string };

export function MembersAdminPanel({
  members: initialMembers,
  currentUserId,
}: {
  members: AdminMember[];
  currentUserId: string;
}) {
  const [members, setMembers] = useState<AdminMember[]>(initialMembers);
  const [toggleState, setToggleState] = useState<Record<string, ToggleState>>({});

  const toggle = useCallback(
    async (member: AdminMember) => {
      setToggleState((prev) => ({ ...prev, [member.id]: { kind: "saving" } }));
      try {
        const res = await apiClient.api.admin.members[":id"].admin.$patch(
          { param: { id: member.id }, json: { isAdmin: !member.isAdmin } } as never,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const error = (body as Record<string, unknown>).error;
          if (res.status === 403 && error === "self_demotion") {
            setToggleState((prev) => ({
              ...prev,
              [member.id]: { kind: "error", message: "You cannot remove your own admin status." },
            }));
            return;
          }
          if (res.status === 409 && error === "last_admin") {
            setToggleState((prev) => ({
              ...prev,
              [member.id]: { kind: "error", message: "Cannot remove the last admin." },
            }));
            return;
          }
          setToggleState((prev) => ({
            ...prev,
            [member.id]: { kind: "error", message: `Something went wrong (${res.status}).` },
          }));
          return;
        }
        setMembers((prev) =>
          prev.map((m) => (m.id === member.id ? { ...m, isAdmin: !member.isAdmin } : m)),
        );
        setToggleState((prev) => ({ ...prev, [member.id]: { kind: "idle" } }));
      } catch {
        setToggleState((prev) => ({
          ...prev,
          [member.id]: { kind: "error", message: "Network error. Please try again." },
        }));
      }
    },
    [],
  );

  return (
    <section className="flex w-full max-w-3xl flex-col gap-4">
      <h2 className="text-lg font-semibold">Members</h2>
      <ul className="flex flex-col gap-2">
        {members.map((member) => {
          const state = toggleState[member.id] ?? { kind: "idle" };
          const isSelf = member.id === currentUserId;
          const initials = member.displayName ? member.displayName[0].toUpperCase() : "?";

          return (
            <li
              key={member.id}
              className="flex items-center gap-3 rounded border border-border p-3"
            >
              {member.avatarUrl ? (
                <img
                  src={member.avatarUrl}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                  {initials}
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">
                  {member.displayName ?? "(unnamed)"}
                </span>
                {member.location && (
                  <span className="text-sm text-muted-foreground">{member.location}</span>
                )}
              </div>
              {member.isAdmin && (
                <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                  Admin
                </span>
              )}
              <div className="flex flex-col items-end gap-1">
                {isSelf ? (
                  <Button size="sm" disabled title="You cannot remove your own admin access">
                    Admin (you)
                  </Button>
                ) : member.isAdmin ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={state.kind === "saving"}
                    onClick={() => toggle(member)}
                  >
                    {state.kind === "saving" ? "Saving…" : "Remove admin"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={state.kind === "saving"}
                    onClick={() => toggle(member)}
                  >
                    {state.kind === "saving" ? "Saving…" : "Make admin"}
                  </Button>
                )}
                {state.kind === "error" && (
                  <p role="alert" className="text-sm text-destructive">
                    {state.message}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
