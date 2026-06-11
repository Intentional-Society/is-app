import * as Sentry from "@sentry/nextjs";

import { scrubServerEvent } from "@/lib/sentry-scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Report from production deploys only — mirrors the client gate in
  // instrumentation-client.ts.
  enabled: process.env.VERCEL_ENV === "production",
  tracesSampleRate: 0.1,
  includeLocalVariables: true,
  beforeSend: scrubServerEvent,
});
