# Sentry Configuration

## Account

- **Org:** intentionalsociety
- **Project:** is-app-sentry
- **Dashboard:** https://intentionalsociety.sentry.io

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SENTRY_DSN` | `.env.local`, Vercel | Client-side error reporting |
| `SENTRY_DSN` | `.env.local`, Vercel | Server-side error reporting |
| `SENTRY_ORG` | `.env.local`, Vercel | Source map upload (org slug) |
| `SENTRY_PROJECT` | `.env.local`, Vercel | Source map upload (project slug) |
| `SENTRY_AUTH_TOKEN` | `.env.local`, Vercel | Source map upload (auth token) |

Auth tokens are generated at Settings → Auth Tokens in the Sentry dashboard.

## How It Works

- **Client errors:** `instrumentation-client.ts` initializes Sentry in the browser with error tracking, performance traces, and session replay
- **Server errors:** `sentry.server.config.ts` loaded via `instrumentation.ts` at server startup
- **React crashes:** `src/app/global-error.tsx` catches uncaught errors and reports to Sentry
- **Source maps:** uploaded automatically during `next build` when `SENTRY_AUTH_TOKEN` is set
- **Tunnel route:** `/monitoring` proxies Sentry events through our domain to avoid ad blockers

## PII Handling

`sendDefaultPii` is **off** on both client and server. With it enabled, Sentry's Next.js SDK auto-attaches request cookies, the `Authorization` header, and the user's IP to every event — all of which expose session tokens for an authenticated app.

Two `beforeSend` scrubbers in `src/lib/sentry-scrub.ts` provide defense-in-depth:

- **Client** (`scrubClientEvent`): on `/auth/`, `/login`, and `/signup` URLs, the query string is dropped from `event.request.url` so OAuth tokens like `?code=...` don't ship. The event itself is still sent so genuine errors on these routes remain visible.
- **Server** (`scrubServerEvent`): deletes `event.request.cookies` and removes the `authorization` and `cookie` headers from every event.

Session replay is configured with `maskAllText: true` and `blockAllMedia: true`, so recordings show only structural placeholders for text and no images/video.

Unit tests for both scrubbers live in `tests/functional/sentry-scrub.test.ts`.

## Sample Rates

| Setting | Development | Production |
|---------|------------|------------|
| Traces | 100% | 10% |
| Session replay | 10% | 10% |
| Replay on error | 100% | 100% |

Adjust in `instrumentation-client.ts` and `sentry.server.config.ts`.
