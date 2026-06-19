import { captureException as Sentry_captureException } from "@sentry/nextjs";

import { serverApiClient } from "@/lib/api-server";

import { RedeemedNamesHint } from "./redeemed-names-hint";

type RedeemedName = { id: string; name: string | null };

const pct = (n: number, total: number): string => (total > 0 ? `${Math.round((n / total) * 100)}%` : "—");

const METRICS_TIMEOUT_MS = 5000;

// Resolve `promise`, or reject after `ms`. Guards against a slow/hung
// metrics read taking the whole page down to a 504: the queries run over
// the Supabase transaction pooler, where a burst of reads can stall, and
// a never-settling await would otherwise block the render past the
// platform timeout.
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`system metrics timed out after ${ms}ms`)), ms)),
  ]);

// Read-only funnel over the DB (see src/server/system-metrics.ts). Fetches
// its own data so the page only has to drop it into a section.
// Best-effort: a failed or slow read renders an inline notice and reports
// to Sentry rather than throwing or hanging, so a metrics hiccup can't
// take down the rest of the page.
export async function SystemMetrics() {
  try {
    const request = serverApiClient.api.metrics.$get();
    // If the timeout wins the race the request keeps running; swallow its
    // eventual settle so it can't surface as an unhandled rejection on a
    // reused Fluid Compute instance.
    request.catch(() => {});
    const res = await withTimeout(request, METRICS_TIMEOUT_MS);
    if (!res.ok) throw new Error(`system metrics request failed: ${res.status}`);
    const { metrics } = await res.json();
    const { members, invites } = metrics;

    const inviteRows: { label: string; value: number; redeemedNames?: RedeemedName[] }[] = [
      { label: "Created", value: invites.created },
      { label: "Redeemed", value: invites.redeemed, redeemedNames: invites.redeemedNames },
      { label: "Pending", value: invites.pending },
      { label: "Expired", value: invites.expired },
      { label: "Revoked", value: invites.revoked },
    ];

    return (
      <div className="flex flex-col gap-4">
        <div className="rounded border border-border bg-background">
          <div className="border-b border-border px-3 py-2 text-sm font-medium">Members</div>
          <dl className="divide-y divide-border">
            <div className="flex items-baseline justify-between px-3 py-1.5 text-sm">
              <dt className="text-muted-foreground">
                Total Members <span className="text-xs">(Deactivated: {members.deactivated})</span>
              </dt>
              <dd className="tabular-nums">{members.total}</dd>
            </div>
            <div className="flex items-baseline justify-between px-3 py-1.5 text-sm">
              <dt className="text-muted-foreground">Onboarding: Agreements / Profile / MyWeb</dt>
              <dd className="tabular-nums">
                {members.signedAgreements} / {members.updatedProfile} / {members.builtWeb}
              </dd>
            </div>
            <div className="flex items-baseline justify-between px-3 py-1.5 text-sm">
              <dt className="text-muted-foreground">Have a Current Intention</dt>
              <dd className="tabular-nums">
                {members.setIntention}
                <span className="ml-2 text-xs text-muted-foreground">{pct(members.setIntention, members.total)}</span>
              </dd>
            </div>
            <div className="flex items-baseline justify-between px-3 py-1.5 text-sm">
              <dt className="text-muted-foreground">In a program (other than Weekly Web Updates)</dt>
              <dd className="tabular-nums">
                {members.joinedProgram}
                <span className="ml-2 text-xs text-muted-foreground">{pct(members.joinedProgram, members.total)}</span>
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded border border-border bg-background">
          <div className="border-b border-border px-3 py-2 text-sm font-medium">Activity</div>
          <dl className="divide-y divide-border">
            <div className="flex items-baseline justify-between px-3 py-1.5 text-sm">
              <dt className="text-muted-foreground">Signed up</dt>
              <dd className="text-xs text-muted-foreground">
                <span className="tabular-nums text-foreground">{members.new7d}</span> past week ·{" "}
                <span className="tabular-nums text-foreground">{members.new30d}</span> past month
              </dd>
            </div>
            <div className="flex items-baseline justify-between px-3 py-1.5 text-sm">
              <dt className="text-muted-foreground">Signed in</dt>
              <dd className="text-xs text-muted-foreground">
                <span className="tabular-nums text-foreground">{members.signedIn7d}</span> past week ·{" "}
                <span className="tabular-nums text-foreground">{members.signedIn30d}</span> past month
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded border border-border bg-background">
          <div className="border-b border-border px-3 py-2 text-sm font-medium">Invites</div>
          <dl className="divide-y divide-border">
            {inviteRows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between px-3 py-1.5 text-sm">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="tabular-nums">
                  {row.value}
                  {row.redeemedNames ? <RedeemedNamesHint names={row.redeemedNames} /> : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    );
  } catch (err) {
    Sentry_captureException(err);
    return <p className="text-sm text-muted-foreground">System metrics unavailable.</p>;
  }
}
