import * as Sentry from "@sentry/nextjs";

import { serverApiClient } from "@/lib/api-server";

const pct = (n: number, total: number): string => (total > 0 ? `${Math.round((n / total) * 100)}%` : "—");

// Read-only funnel over the DB (see src/server/activity-metrics.ts).
// Fetches its own data so the admin page only has to drop it into a
// section. Best-effort: a failed read renders an inline notice and
// reports to Sentry rather than throwing, so a metrics hiccup can't take
// down the rest of the admin page.
export async function ActivityMetrics() {
  try {
    const res = await serverApiClient.api.admin.activity.$get();
    if (!res.ok) throw new Error(`activity metrics request failed: ${res.status}`);
    const { metrics } = await res.json();
    const { members, invites, sinceLaunch, launchDate } = metrics;

    const launchLabel = new Date(launchDate).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    const sinceRows = [
      { label: "Signed in", value: sinceLaunch.signedIn },
      { label: "Signed agreements", value: sinceLaunch.signedAgreements },
      { label: "Set an intention", value: sinceLaunch.setIntention },
      { label: "Edited their profile", value: sinceLaunch.editedProfile },
      { label: "Built their web", value: sinceLaunch.builtWeb },
      { label: "Joined a program", value: sinceLaunch.joinedProgram },
      { label: "Invites created", value: sinceLaunch.invitesCreated },
      { label: "Invites redeemed", value: sinceLaunch.invitesRedeemed },
    ];

    const funnel = [
      { label: "Signed up", value: members.total },
      { label: "Signed agreements", value: members.signedAgreements },
      { label: "Set an intention", value: members.setIntention },
      { label: "Edited their profile", value: members.updatedProfile },
      { label: "Built their web", value: members.builtWeb },
      { label: "Joined a program", value: members.joinedProgram },
    ];

    const inviteRows = [
      { label: "Created", value: invites.created },
      { label: "Redeemed", value: invites.redeemed },
      { label: "Pending", value: invites.pending },
      { label: "Expired", value: invites.expired },
      { label: "Revoked", value: invites.revoked },
    ];

    return (
      <div className="flex flex-col gap-4">
        <div className="rounded border border-primary/40 bg-primary/5">
          <div className="border-b border-border px-3 py-2 text-sm font-medium">
            Since launch <span className="font-normal text-muted-foreground">· {launchLabel}</span>
          </div>
          <dl className="divide-y divide-border">
            {sinceRows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between px-3 py-1.5 text-sm">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded border border-border">
          <div className="border-b border-border px-3 py-2 text-sm font-medium">
            Members{" "}
            <span className="font-normal text-muted-foreground">
              · {members.new7d} new this week · {members.new30d} this month (all time)
            </span>
          </div>
          <dl className="divide-y divide-border">
            {funnel.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between px-3 py-1.5 text-sm">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="tabular-nums">
                  {row.value}
                  <span className="ml-2 text-xs text-muted-foreground">{pct(row.value, members.total)}</span>
                </dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            Signed in: <span className="tabular-nums text-foreground">{members.signedIn7d}</span> past week ·{" "}
            <span className="tabular-nums text-foreground">{members.signedIn30d}</span> past month (last full sign-in) ·
            Deactivated: <span className="tabular-nums text-foreground">{members.deactivated}</span>
          </div>
        </div>

        <div className="rounded border border-border">
          <div className="border-b border-border px-3 py-2 text-sm font-medium">Invites (all time)</div>
          <dl className="divide-y divide-border">
            {inviteRows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between px-3 py-1.5 text-sm">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    );
  } catch (err) {
    Sentry.captureException(err);
    return <p className="text-sm text-muted-foreground">Activity metrics unavailable.</p>;
  }
}
