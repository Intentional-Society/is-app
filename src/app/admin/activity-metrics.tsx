import * as Sentry from "@sentry/nextjs";

import { serverApiClient } from "@/lib/api-server";

const pct = (n: number, total: number): string => (total > 0 ? `${Math.round((n / total) * 100)}%` : "—");

const METRICS_TIMEOUT_MS = 5000;

// Resolve `promise`, or reject after `ms`. Guards against a slow/hung
// metrics read taking the whole admin page down to a 504: the queries
// run over the Supabase transaction pooler, where a burst of reads can
// stall, and a never-settling await would otherwise block the render
// past the platform timeout.
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`activity metrics timed out after ${ms}ms`)), ms)),
  ]);

// Read-only funnel over the DB (see src/server/activity-metrics.ts).
// Fetches its own data so the admin page only has to drop it into a
// section. Best-effort: a failed or slow read renders an inline notice
// and reports to Sentry rather than throwing or hanging, so a metrics
// hiccup can't take down the rest of the admin page.
export async function ActivityMetrics() {
  try {
    const request = serverApiClient.api.admin.activity.$get();
    // If the timeout wins the race the request keeps running; swallow its
    // eventual settle so it can't surface as an unhandled rejection on a
    // reused Fluid Compute instance.
    request.catch(() => {});
    const res = await withTimeout(request, METRICS_TIMEOUT_MS);
    if (!res.ok) throw new Error(`activity metrics request failed: ${res.status}`);
    const { metrics } = await res.json();
    const { members, invites } = metrics;

    const funnel = [
      { label: "Signed up", value: members.total },
      { label: "Signed agreements", value: members.signedAgreements },
      { label: "Set an intention", value: members.setIntention },
      { label: "Filled out profile", value: members.updatedProfile },
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
        <div className="rounded border border-border">
          <div className="border-b border-border px-3 py-2 text-sm font-medium">
            Members{" "}
            <span className="font-normal text-muted-foreground">
              · {members.new7d} new this week · {members.new30d} this month
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
          <div className="border-b border-border px-3 py-2 text-sm font-medium">Invites</div>
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
