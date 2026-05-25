"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { AdminMember } from "@/lib/api-types";

const QUERY_KEY = ["admin", "members"] as const;
const STALE_TIME = 5 * 60 * 1000;

type ToggleVars = { member: AdminMember; isAdmin: boolean };
type ToggleError = Error & { memberId?: string };

const fetchMembers = async (): Promise<AdminMember[]> => {
  const res = await apiClient.api.admin.members.$get();
  if (!res.ok) throw new Error(`admin/members: ${res.status}`);
  const body = await res.json();
  return body.members;
};

export function MembersAdminPanel({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();

  const membersQuery = useQuery({ queryKey: QUERY_KEY, queryFn: fetchMembers, staleTime: STALE_TIME });

  const mutation = useMutation<ToggleVars, ToggleError, ToggleVars>({
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
          {membersQuery.data.map((member) => {
            const isSelf = member.id === currentUserId;
            const isSaving = mutation.isPending && mutation.variables?.member.id === member.id;
            const errorMessage =
              mutation.isError && mutation.error.memberId === member.id ? mutation.error.message : null;

            return (
              <li
                key={member.id}
                className="flex items-center gap-3 rounded border border-border p-3"
              >
                <Avatar
                  name={member.displayName}
                  url={member.avatarUrl}
                  sizes="32px"
                  className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium text-muted-foreground"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{member.displayName ?? "(unnamed)"}</span>
                  {member.location && (
                    <span className="text-sm text-muted-foreground">{member.location}</span>
                  )}
                </div>
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
                      onClick={() => mutation.mutate({ member, isAdmin: false })}
                    >
                      {isSaving ? "Saving…" : "Remove admin"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={isSaving}
                      onClick={() => mutation.mutate({ member, isAdmin: true })}
                    >
                      {isSaving ? "Saving…" : "Make admin"}
                    </Button>
                  )}
                  {errorMessage && (
                    <p role="alert" className="text-sm text-destructive">
                      {errorMessage}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
