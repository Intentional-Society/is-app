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
