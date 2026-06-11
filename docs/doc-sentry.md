# Sentry Configuration

## Account

- **Org:** intentionalsociety
- **Project:** is-app-sentry
- **Dashboard:** https://intentionalsociety.sentry.io

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel (Production only) | Client-side error reporting |
| `SENTRY_DSN` | Vercel (Production only) | Server-side error reporting |
| `SENTRY_ORG` | `.env.local`, Vercel | Source map upload (org slug) |
| `SENTRY_PROJECT` | `.env.local`, Vercel | Source map upload (project slug) |
| `SENTRY_AUTH_TOKEN` | `.env.local`, Vercel | Source map upload (auth token) |

Auth tokens are generated at Settings → Auth Tokens in the Sentry dashboard.

## How It Works

- **Client errors:** `instrumentation-client.ts` initializes Sentry in the browser with error tracking, performance traces, and opt-in session replay (see below)
- **Server errors:** `sentry.server.config.ts` loaded via `instrumentation.ts` at server startup
- **React crashes:** `src/app/global-error.tsx` catches uncaught errors and reports to Sentry
- **Source maps:** uploaded automatically during `next build` when `SENTRY_AUTH_TOKEN` is set
- **Tunnel route:** `/error-handling` proxies all browser-side Sentry traffic (errors, traces, replay) through our domain to avoid ad blockers
- **Production deploys only:** both init configs set `enabled` on `VERCEL_ENV === "production"` (inlined into the client bundle via the `env` key in `next.config.ts`). Preview deploys and local dev send nothing — preview e2e runs were generating thousands of tunnel POSTs per run, tripping Vercel traffic-spike alerts

## PII Handling

`sendDefaultPii` is **off** on both client and server. With it enabled, Sentry's Next.js SDK auto-attaches request cookies, the `Authorization` header, and the user's IP to every event — all of which expose session tokens for an authenticated app.

Two `beforeSend` scrubbers in `src/lib/sentry-scrub.ts` provide defense-in-depth:

- **Client** (`scrubClientEvent`): on `/auth/`, `/signin`, and `/signup` URLs, the query string is dropped from `event.request.url` so OAuth tokens like `?code=...` don't ship. The event itself is still sent so genuine errors on these routes remain visible.
- **Server** (`scrubServerEvent`): deletes `event.request.cookies` and removes the `authorization` and `cookie` headers from every event.

Unit tests for both scrubbers live in `tests/functional/sentry-scrub.test.ts`.

## Session Replay — opt-in only

Replay records nothing by default. To see what a user is experiencing in a "works on my machine" scenario, have them load any page with `?debug-replay=1` — that browser session then records at 100% (including buffered capture of any errors) and appears under Replays in the Sentry dashboard. The flag persists in `sessionStorage`, so it survives navigation within the app and clears when the tab closes.

Recordings are masked: `maskAllText: true` and `blockAllMedia: true` mean only structural placeholders for text and no images/video.

## Sample Rates

Sentry reports from production deploys only (the `enabled` gate), so a single set of rates applies:

| Setting | Rate |
|---------|------|
| Traces | 10% |
| Session replay | 0% (100% with `?debug-replay=1`) |
| Replay on error | 0% (100% with `?debug-replay=1`) |

Adjust in `instrumentation-client.ts` and `sentry.server.config.ts`.
