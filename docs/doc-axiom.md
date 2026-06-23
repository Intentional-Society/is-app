# Axiom Configuration

## Account

- **Organization:** intentional-society-axiom
- **Dashboard:** https://app.axiom.co/intentional-society-axiom-nnvi/

## How It Works

Axiom receives logs through two channels:

- **Vercel Log Drain** — all serverless function stdout/stderr is streamed to Axiom automatically via the Vercel marketplace integration. No SDK or API key needed for this. Shipped platform-side, so it records that a request ran regardless of anything that happened inside the function — the authoritative invocation history.
- **next-axiom** — the `next-axiom` package wraps `next.config.ts` and provides:
  - `log.info()` / `log.warn()` / `log.error()` / `log.debug()` for structured logging from client and server
  - Automatic Web Vitals reporting

## Logging conventions

Two rules keep logs queryable in Axiom:

- **App code that should reach Axiom uses `log.<level>()`** from `next-axiom` (`log.info` / `warn` / `error` / `debug`). The **message is a stable feature label**, and structured data goes in the fields object — `log.info("api request", { method, path, status })`. next-axiom nests the object under `fields`, so a consistent label lets every query filter by `message` and split on `['fields.*']` (see the canonical example at `src/server/api.ts`, and the Buttondown queries below). Reusing a label across call sites is deliberate: the `"probe-149"` events in `/me`, the home page, and `/_test/reset` all carry `fields.route` so one query compares them.
- **`console.log` is only for explicit dev/test helpers** whose output you read inline as raw text, never telemetry you'd query — e.g. `src/lib/timing.ts`, a header-gated latency print, and the `tests/`/`scripts/` tooling. A raw `console.log` still reaches Axiom via the Vercel log drain, but lands as an unstructured `message` string you can't filter on.

This is enforced by Biome's `suspicious/noConsole` rule, with per-path `off` overrides in `biome.json` for the legitimate helpers above. To add app telemetry, reach for `log.<level>` — if Biome flags a `console` call, that's the signal.

One caveat: `next-axiom`'s `log` buffers in-process and sends on a 1s throttle. A frozen serverless instance silently loses any unsent batch, and a failed send is dropped by the library, not retried — so events are only delivered reliably where something flushes before the function freezes:

- **API requests** — the Hono logging middleware (`src/server/api.ts`) ends every request with `waitUntil(log.flush())`, which keeps the instance alive until the batch lands without delaying the response.
- **Server Components** — no middleware runs, so `await log.flush()` after logging (as `src/app/page.tsx` does).

## Request Logging

Every API request is logged by Hono middleware in `src/server/api.ts` with:
- `method` — HTTP method
- `path` — request path
- `status` — response status code
- `duration` — response time in milliseconds
- `userId` — the authenticated Supabase user UUID, or `null` on public/401 paths. This is the pseudonymous auth id only (never the email), keeping the log line consistent with the PII stance in `doc-sentry.md`.

`userId` is what makes per-person analysis possible — distinct visitors, per-path adoption, return visits — that the request shape alone can't give. `next-axiom` nests it under `fields`, so query it as `['fields.userId']`:

- **Distinct people active in a window:** `["vercel"] | where message == "api request" | summarize dcount(['fields.userId'])`
- **Adoption by path (who touched what):** `["vercel"] | where message == "api request" | summarize dcount(['fields.userId']) by ['fields.path']`

For funnel and per-member-state questions (signed up → set intention → built web → joined a program, plus the invite funnel), the DB is the better source — see the member-facing **System Metrics** section on the `/about` page (backed by `src/server/system-metrics.ts`), which reads current state rather than aging-out logs.

## Environment Variables

No Axiom-specific env vars are needed in the app. The Vercel Log Drain integration handles authentication automatically. `next-axiom` reads the Vercel-provided `NEXT_PUBLIC_AXIOM_INGEST_ENDPOINT` at build time.

## Buttondown sync — canonical queries

The sync emits two message families: `"buttondown sync"` (structured events with an action) and `"buttondown http"` (one per outbound Buttondown API call). The `next-axiom` package nests every structured key under a top-level `fields` object, and Axiom indexes the nested JSON as flattened column names — so the canonical queries below access them as `['fields.x']` (the whole dotted path inside one bracketed string). Every event carries `['fields.runId']`, which for cron runs is `cron:<iso-timestamp>`, for admin runs is `admin:<profileId>:(dry-run|write)`, and for inline first-save is `first-save:<profileId>`.

- **Cron summary trend (run duration, counts):**
  `["vercel"] | where message == "buttondown sync" and ['fields.action'] == "summary" | summarize avg(['fields.durationMs']), sum(['fields.errors']), sum(['fields.tagsUpdated']) by bin_auto(_time)`
- **Per-profile errors by kind:**
  `["vercel"] | where message == "buttondown sync" and ['fields.action'] == "error" | summarize count() by ['fields.errorKind'], bin_auto(_time)`
- **Unsubscribe alerts (operator follow-up queue):**
  `["vercel"] | where message == "buttondown sync" and ['fields.action'] == "unsubscribe-alert"`
- **Buttondown HTTP health (status distribution, p95 latency):**
  `["vercel"] | where message == "buttondown http" | summarize count(), avg(['fields.durationMs']), percentile(['fields.durationMs'], 95) by ['fields.status'], ['fields.path']`
- **Rate-limit hits:**
  `["vercel"] | where message == "buttondown http" and ['fields.status'] == 429`
- **Dry-run vs write traffic split:**
  `["vercel"] | where message == "buttondown sync" and ['fields.action'] == "summary" | summarize count() by ['fields.write']`
- **Lock retry budget — how often does retry save us?**
  `["vercel"] | where message == "buttondown sync" and ['fields.action'] == "lock-acquired" | summarize count() by ['fields.attempts']`
  Distribution of `attempts` across runs. `1` means no contention; `>1` means a retry succeeded. Pair with `skipped-lock-held` count (retries exhausted) to size the budget.
- **One specific run (all events, by runId):**
  `["vercel"] | where message == "buttondown sync" and ['fields.runId'] == "<runId>"`
- **Authoritative invocation history (did the cron fire at all):**
  `["vercel"] | where ['request.path'] == "/api/cron/buttondown-sync" | project _time, ['request.statusCode'] | sort by _time desc`
  Vercel log-drain records, independent of the in-process flush — present even for a run whose `next-axiom` events never arrived. When a cron run seems missing, this query distinguishes "didn't run" from "didn't log".

Sentry surfaces the page-worthy events: `buttondown.sync_profile_error` (one per failing profile, tagged with `errorKind`), `buttondown.sync_lock_held` (cron overlap), and `buttondown.unsubscribed_member` (member-with-active-program who unsubscribed). Each Sentry issue's `runId` tag links back to the Axiom query above.

## Dashboard: IS Web Overall

Paste each query into an Axiom dashboard panel (Dashboards → IS Web Overall → add chart → paste APL). "Traffic" for an authenticated membership app splits into two questions answered by two sources inside the one `["vercel"]` dataset — and the dataset is **~60% preview/CI noise**, so source and environment scoping is mandatory, not cosmetic:

- **Member activity & feature adoption** — the `next-axiom` `"api request"` events (`vercel.source == "frontend-log-log"`). These are the only events carrying `['fields.userId']`, and they are emitted **only by production** (preview deploys don't ingest them), so they need no environment filter — they just strip the e2e endpoints (`/api/_test/*`, which run against production and have a null `userId`). They cover `/api/*` only.
- **Whole-site request volume** — the `lambda` source access records (`['request.path']` / `['request.statusCode']`), one row per dynamic request (page render or API call). These carry **no member identity** and are **~⅔ preview**, so every panel filters `['vercel.environment'] == "production"`. Scope to `vercel.source == "lambda"`: `request.path` also rides on `lambda-log` (console lines), `static` (assets) and `external` (edge), so `isnotnull(['request.path'])` alone would count each request several times over.

The load-bearing limit: **you cannot ask "distinct members who viewed page X"** — page-route hits log no `userId`; only API calls do.

Verified against the live dataset (the `take 5` / source-breakdown probes): `['fields.*']` is the correct field form (there is no bare top-level `path`), and `fields.status` / `fields.duration` are numeric, so no type coercion is needed on them. `request.statusCode`'s type was not confirmed, so the one panel that compares it keeps a defensive `toint()`. Grouping a table or top-list by a dotted field (`by ['fields.path']`) returns it as a nested `{fields:{path}}` column — flatten it first with `extend path = ['fields.path']`, then group `by path`. And a `where` after `summarize` flips a Table element into the raw-event JSON view — keep Table pipelines to `summarize` then `top`, applying any row filter before the `summarize` (or via a subquery).

The dashboard is four thematic columns — **Members**, **Totals**, **Requests**, **Performance** — each with two panels, in this order.

### Members

- **Active Members (DAU):** Timeseries — true daily active members, one bucket per UTC day. Pinned to `bin(_time, 1d)` because a distinct count doesn't sum across buckets, so the bucket width *is* the metric's definition; `bin_auto` would silently turn this into hourly-active over a multi-day range.

```
["vercel"] | where message == "api request" and isnotnull(['fields.userId']) and ['fields.path'] !startswith "/api/_test" | summarize members = dcount(['fields.userId']) by bin(_time, 1d)
```

- **Active Members (bin_auto):** Timeseries — distinct members per auto-sized bucket. Shows activity *rhythm* within the selected range (buckets shrink toward hourly at a 7–15d range), so read it as "how busy, and when," not as a daily headcount.

```
["vercel"] | where message == "api request" and isnotnull(['fields.userId']) and ['fields.path'] !startswith "/api/_test" | summarize members = dcount(['fields.userId']) by bin_auto(_time)
```


### Totals

- **Total Active Users:** Statistic — distinct members within the selected time range (reads as WAU/MAU as you widen the picker, not an all-time total).

```
["vercel"] | where message == "api request" and isnotnull(['fields.userId']) and ['fields.path'] !startswith "/api/_test" | summarize members = dcount(['fields.userId'])
```

- **Top API Requests:** Table — API paths ranked by request count. `topk` ranks *inside* the `summarize`, so nothing follows it: Axiom's Simple chart editor allows only `take`/`limit` after `summarize`, and `take` alone would return arbitrary rows, not the busiest. (`summarize count() by path | top 25 by count_` is equivalent but needs the chart's APL mode.)

```
["vercel"] | where message == "api request" and ['fields.path'] !startswith "/api/_test" | summarize topk(['fields.path'], 25)
```


### Requests

- **Requests: Anon vs Signed-in:** stacked Timeseries — `authed` separates member traffic from public/401 traffic (anonymous = public pages, auth flows, 401s).

```
["vercel"] | where message == "api request" and ['fields.path'] !startswith "/api/_test" | extend authed = isnotnull(['fields.userId']) | summarize requests = count() by authed, bin_auto(_time)
```

- **Requests: by user by day:** Timeseries (stacked bars) — daily request count per member, every active member a stack segment. Axiom has no per-bucket top-N operator (`topk` collapses the time axis; there's no `partition`/window rank), so this shows all daily-active members rather than a hard top-5 — at this membership's scale that reads as the day's top contributors anyway. Pin `bin(_time, 1d)` so each bar is one day.

```
["vercel"] | where message == "api request" and isnotnull(['fields.userId']) and ['fields.path'] !startswith "/api/_test" | summarize requests = count() by ['fields.userId'], bin(_time, 1d)
```


### Performance

- **Latency percentiles (ms):** multi-line Timeseries — p50/p95/p99 of request `duration`, in milliseconds; the three aggregations render as separate charts by default — tick **Merge Charts** to overlay them as three lines on one graph. Don't use *stacked* bars: percentiles nest (p99 ≥ p95 ≥ p50), so a stack sums to a meaningless total (grouped bars would be fine, lines are clearer). Axiom's y-axis carries no unit, so a `1.5K` tick means 1,500 ms (1.5 s); the `_ms` series aliases and the panel title keep the unit visible. Bucketed at a fixed `bin(_time, 12h)` (not `bin_auto`) for a steady resolution across ranges, on a **log y-axis** since latency spans orders of magnitude (p50 in tens of ms, p99 up to seconds).

```
["vercel"] | where message == "api request" and ['fields.path'] !startswith "/api/_test" | summarize p50_ms = percentile(['fields.duration'], 50), p95_ms = percentile(['fields.duration'], 95), p99_ms = percentile(['fields.duration'], 99) by bin(_time, 12h)
```

- **Slowest paths (p95 ms):** Table — API paths ranked by p95 latency; the `requests` column shows sample size, so a p95 backed by a handful of calls is easy to discount (small-sample p95 is jumpy). No request-count floor: a `where` after `summarize` flips the Table into the raw-event JSON view, so the filter is left out. Must be a **Table**, not a Top list — Top list ranks only by `count`/`topk`/`topkif`, so it can't rank by a percentile; the Table query is `summarize` then `top 20 by p95_ms`, no `where` between.

```
["vercel"] | where message == "api request" and ['fields.path'] !startswith "/api/_test" | extend path = ['fields.path'] | summarize p95_ms = percentile(['fields.duration'], 95), requests = count() by path | top 20 by p95_ms
```


### Not on the dashboard yet (candidates)

_Drafted but not added to IS Web Overall: Adoption below, plus the Health & latency and Whole-site volume groups. A panel that ranks by a non-count aggregate (e.g. Adoption, by distinct members) must use a **Table** element with `top N by <expr>` after `summarize` — the **Top list** element ranks only by `count`/`topk`/`topkif` (one expression, only `take`/`limit` after `summarize`), so it can't rank by `dcount` or a percentile._

- **Adoption by path (distinct members per path):** Table — which features people actually reach.

```
["vercel"] | where message == "api request" and isnotnull(['fields.userId']) and ['fields.path'] !startswith "/api/_test" | summarize members = dcount(['fields.userId']) by ['fields.path'] | top 20 by members
```


### Health & latency

- **Status class over time:** stacked Timeseries (`2xx` / `4xx` / `5xx`).

```
["vercel"] | where message == "api request" and ['fields.path'] !startswith "/api/_test" | extend status_class = strcat(substring(tostring(['fields.status']), 0, 1), "xx") | summarize requests = count() by status_class, bin_auto(_time)
```

- **Errors by status code:** Timeseries of the failures only.

```
["vercel"] | where message == "api request" and ['fields.status'] >= 400 and ['fields.path'] !startswith "/api/_test" | summarize errors = count() by ['fields.status'], bin_auto(_time)
```


### Whole-site volume (lambda source — pages + API, production only)

- **Dynamic request volume over time:** Timeseries; one row per page render or API call.

```
["vercel"] | where ['vercel.source'] == "lambda" and ['vercel.environment'] == "production" and ['request.path'] !startswith "/api/_test" | summarize requests = count() by bin_auto(_time)
```

- **Top routes site-wide:** Table; includes page navigations the `"api request"` events never see.

```
["vercel"] | where ['vercel.source'] == "lambda" and ['vercel.environment'] == "production" and ['request.path'] !startswith "/api/_test" | summarize requests = count() by ['request.path'] | top 30 by requests
```

- **Non-2xx at the edge:** Table of platform-level failures (bad pages, redirects, 404s).

```
["vercel"] | where ['vercel.source'] == "lambda" and ['vercel.environment'] == "production" and toint(['request.statusCode']) >= 400 and ['request.path'] !startswith "/api/_test" | summarize requests = count() by ['request.statusCode'], ['request.path'] | top 30 by requests
```


**Not included: Web Vitals.** `next-axiom` ships `<AxiomWebVitals/>` but it is not mounted in the app, so no LCP/CLS/INP data flows yet. Mount it in the root layout first; then a percentile-over-time panel on those events becomes worthwhile.
