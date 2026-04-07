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

## Sample Rates

| Setting | Development | Production |
|---------|------------|------------|
| Traces | 100% | 10% |
| Session replay | 10% | 10% |
| Replay on error | 100% | 100% |

Adjust in `instrumentation-client.ts` and `sentry.server.config.ts`.
