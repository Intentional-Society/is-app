"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api";
import type { AdminSignin } from "@/lib/api-types";
import { formatDateTime } from "@/lib/format-date";

const QUERY_KEY = ["admin", "signins"] as const;
const STALE_TIME = 5 * 60 * 1000;

const fetchSignins = async (): Promise<AdminSignin[]> => {
  const res = await apiClient.api.admin.signins.$get();
  if (!res.ok) throw new Error(`admin/signins: ${res.status}`);
  const body = await res.json();
  return body.signins;
};

function SigninRow({ member, detail }: { member: AdminSignin; detail: string | null }) {
  // lastActivityAt covers live sessions only, so it matches lastSignInAt
  // for everyone else — show it only when it adds information.
  const activity =
    member.lastActivityAt && member.lastActivityAt !== member.lastSignInAt
      ? formatDateTime(member.lastActivityAt)
      : null;

  return (
    <li className="flex items-center gap-3 rounded border border-border px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-medium">{member.displayName ?? "(unnamed)"}</span>
      {member.hidden && <span className="shrink-0 text-xs text-muted-foreground">hidden</span>}
      {member.deactivated && <span className="shrink-0 text-xs text-muted-foreground">deactivated</span>}
      <span className="flex shrink-0 flex-col items-end">
        {detail && <span className="text-sm text-muted-foreground">{detail}</span>}
        {activity && <span className="text-xs text-muted-foreground">active {activity}</span>}
      </span>
    </li>
  );
}

export function SigninsAdminPanel() {
  const signinsQuery = useQuery({ queryKey: QUERY_KEY, queryFn: fetchSignins, staleTime: STALE_TIME });

  if (signinsQuery.isPending) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (signinsQuery.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn't load sign-ins.
      </p>
    );
  }

  // The API returns rows already ordered most-recent-first with
  // never-signed-in members at the end, so a partition keeps that order.
  const signedIn = signinsQuery.data.filter((m) => m.lastSignInAt !== null);
  const neverSignedIn = signinsQuery.data.filter((m) => m.lastSignInAt === null);

  return (
    <div className="flex w-full max-w-xl flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Most recent sign-in</h2>
        <p className="text-sm text-muted-foreground">
          Timestamps record the last full sign-in — a member with a live session who only refreshes their token keeps
          their old timestamp. An "active" line shows the latest token refresh, available only while that session is
          still alive.
        </p>
        {signedIn.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one has signed in yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {signedIn.map((member) => (
              <SigninRow key={member.id} member={member} detail={formatDateTime(member.lastSignInAt as string)} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Never signed in</h2>
        {neverSignedIn.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everyone has signed in at least once.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {neverSignedIn.map((member) => (
              <SigninRow key={member.id} member={member} detail={null} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
