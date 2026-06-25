"use client";

import { type UseMutationResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api";
import type { AdminMember } from "@/lib/api-types";

const QUERY_KEY = ["admin", "members"] as const;
const STALE_TIME = 5 * 60 * 1000;

type ToggleVars = { member: AdminMember; isAdmin: boolean };
type ToggleError = Error & { memberId?: string };
type ToggleMutation = UseMutationResult<ToggleVars, ToggleError, ToggleVars>;

type DeleteVars = { id: string };
type DeleteError = Error & { memberId?: string };
type DeleteMutation = UseMutationResult<DeleteVars, DeleteError, DeleteVars>;

const fetchMembers = async (): Promise<AdminMember[]> => {
  const res = await apiClient.api.admin.members.$get();
  if (!res.ok) throw new Error(`admin/members: ${res.status}`);
  const body = await res.json();
  return body.members;
};

export function MembersAdminPanel({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();

  const membersQuery = useQuery({ queryKey: QUERY_KEY, queryFn: fetchMembers, staleTime: STALE_TIME });

  const toggleMutation = useMutation<ToggleVars, ToggleError, ToggleVars>({
    mutationFn: async (vars) => {
      const res = await apiClient.api.admin.members[":id"].admin.$patch({
        param: { id: vars.member.id },
        json: { isAdmin: vars.isAdmin },
      } as never);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 403 && body.error === "self_demotion") {
          throw Object.assign(new Error("You cannot remove your own admin status."), { memberId: vars.member.id });
        }
        if (res.status === 409 && body.error === "last_admin") {
          throw Object.assign(new Error("Cannot remove the last admin."), { memberId: vars.member.id });
        }
        throw Object.assign(new Error(`Something went wrong (${res.status}).`), { memberId: vars.member.id });
      }
      return vars;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const deleteMutation = useMutation<DeleteVars, DeleteError, DeleteVars>({
    mutationFn: async (vars) => {
      const res = await apiClient.api.admin.members[":id"].$delete({ param: { id: vars.id } } as never);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const message =
          res.status === 403 && body.error === "self_delete"
            ? "You can't delete your own account here — use deactivate."
            : res.status === 409 && body.error === "is_admin"
              ? "Remove this member's admin access before deleting."
              : `Something went wrong (${res.status}).`;
        throw Object.assign(new Error(message), { memberId: vars.id });
      }
      return vars;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return (
    <div className="flex flex-col gap-2">
      {membersQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : membersQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load members.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {membersQuery.data.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isSelf={member.id === currentUserId}
              toggleMutation={toggleMutation}
              deleteMutation={deleteMutation}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberRow({
  member,
  isSelf,
  toggleMutation,
  deleteMutation,
}: {
  member: AdminMember;
  isSelf: boolean;
  toggleMutation: ToggleMutation;
  deleteMutation: DeleteMutation;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const isSaving = toggleMutation.isPending && toggleMutation.variables?.member.id === member.id;
  const isDeleting = deleteMutation.isPending && deleteMutation.variables?.id === member.id;
  const toggleError =
    toggleMutation.isError && toggleMutation.error.memberId === member.id ? toggleMutation.error.message : null;
  const deleteError =
    deleteMutation.isError && deleteMutation.error.memberId === member.id ? deleteMutation.error.message : null;

  // Type-to-confirm phrase: the display name, or "DELETE" for the rare
  // unnamed (mid-onboarding) member whose name can't be typed.
  const confirmPhrase = member.displayName?.trim() || "DELETE";
  const confirmMatches = confirmText.trim() === confirmPhrase;

  const cancelConfirm = () => {
    setConfirming(false);
    setConfirmText("");
  };

  return (
    <li className="flex flex-col gap-3 rounded border border-border p-3">
      <div className="flex items-center gap-3">
        <Avatar
          name={member.displayName}
          url={member.avatarUrl}
          sizes="32px"
          className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium text-muted-foreground"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{member.displayName ?? "(unnamed)"}</span>
          {member.location && <span className="text-sm text-muted-foreground">{member.location}</span>}
        </div>
        {member.isAdmin && <ShieldCheck className="h-4 w-4 shrink-0 text-green-700" aria-label="Admin" />}
        <div className="flex flex-col items-end gap-1">
          {isSelf ? (
            <Button size="sm" disabled title="You cannot remove your own admin access">
              Admin (you)
            </Button>
          ) : member.isAdmin ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={isSaving}
              onClick={() => toggleMutation.mutate({ member, isAdmin: false })}
            >
              {isSaving ? "Saving…" : "Remove admin"}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" disabled={isSaving} onClick={() => toggleMutation.mutate({ member, isAdmin: true })}>
                {isSaving ? "Saving…" : "Make admin"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={confirming || isDeleting}
                onClick={() => setConfirming(true)}
              >
                Delete account
              </Button>
            </div>
          )}
          {toggleError && (
            <p role="alert" className="text-sm text-destructive">
              {toggleError}
            </p>
          )}
        </div>
      </div>

      {confirming && (
        <div className="flex flex-col gap-2 rounded border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm">
            Permanently delete <span className="font-medium">{member.displayName ?? "this member"}</span>? This removes
            their profile, avatar, all relationships, and program memberships. Invites they sent or redeemed are kept
            but anonymized. This cannot be undone.
          </p>
          <label htmlFor={`confirm-delete-${member.id}`} className="text-sm text-muted-foreground">
            Type <span className="font-medium text-foreground">{confirmPhrase}</span> to confirm
          </label>
          <Input
            id={`confirm-delete-${member.id}`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={isDeleting}
            autoComplete="off"
          />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={isDeleting} onClick={cancelConfirm}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!confirmMatches || isDeleting}
              onClick={() => deleteMutation.mutate({ id: member.id })}
            >
              {isDeleting ? "Deleting…" : "Delete account"}
            </Button>
          </div>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
