# Axiom Configuration

## Account

- **Organization:** intentional-society-axiom
- **Dashboard:** https://app.axiom.co/intentional-society-axiom-nnvi/

## How It Works

Axiom receives logs through two channels:

- **Vercel Log Drain** — all serverless function stdout/stderr is streamed to Axiom automatically via the Vercel marketplace integration. No SDK or API key needed for this.
- **next-axiom** — the `next-axiom` package wraps `next.config.ts` and provides:
  - `log.info()` / `log.warn()` / `log.error()` / `log.debug()` for structured logging from client and server
  - Automatic Web Vitals reporting

## Request Logging

Every API request is logged by Hono middleware in `src/server/api.ts` with:
- `method` — HTTP method
- `path` — request path
- `status` — response status code
- `duration` — response time in milliseconds

## Environment Variables

No Axiom-specific env vars are needed in the app. The Vercel Log Drain integration handles authentication automatically. `next-axiom` reads the Vercel-provided `NEXT_PUBLIC_AXIOM_INGEST_ENDPOINT` at build time.

## Buttondown sync — canonical queries

The sync emits two message families: `"buttondown sync"` (structured events with a `fields.action`) and `"buttondown http"` (one per outbound Buttondown API call). Every event carries `fields.runId`, which for cron runs is `cron:<iso-timestamp>`, for admin runs is `admin:<profileId>:(dry-run|write)`, and for inline first-save is `first-save:<profileId>`.

- **Cron summary trend (run duration, counts):**
  `["vercel"] | where ['service.name'] == "is-app" | where message == "buttondown sync" and fields.action == "summary" | summarize avg(fields.durationMs), sum(fields.errors), sum(fields.tagsUpdated) by bin_auto(_time)`
- **Per-profile errors by kind:**
  `["vercel"] | where message == "buttondown sync" and fields.action == "error" | summarize count() by fields.errorKind, bin_auto(_time)`
- **Unsubscribe alerts (operator follow-up queue):**
  `["vercel"] | where message == "buttondown sync" and fields.action == "unsubscribe-alert"`
- **Buttondown HTTP health (status distribution, p95 latency):**
  `["vercel"] | where message == "buttondown http" | summarize count(), avg(fields.durationMs), percentile(fields.durationMs, 95) by fields.status, fields.path`
- **Rate-limit hits:**
  `["vercel"] | where message == "buttondown http" and fields.status == 429`
- **Dry-run vs write traffic split:**
  `["vercel"] | where message == "buttondown sync" and fields.action == "summary" | summarize count() by fields.write`

Sentry surfaces the page-worthy events: `buttondown.sync_profile_error` (one per failing profile, tagged with `errorKind`), `buttondown.sync_lock_held` (cron overlap), and `buttondown.unsubscribed_member` (member-with-active-program who unsubscribed). Each Sentry issue's `runId` tag links back to the Axiom query above.
