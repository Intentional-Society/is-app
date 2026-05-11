import * as Sentry from "@sentry/nextjs";

import { scrubServerEvent } from "@/lib/sentry-scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  // includeLocalVariables is intentionally omitted: it attaches the V8
  // inspector at module load and intercepts every function call to keep
  // frame info available, which materially slows cold-start and adds
  // steady-state runtime overhead. The trade-off is less context in
  // captured error reports — re-enable per environment if we ever need
  // it for a specific debugging session.
  beforeSend: scrubServerEvent,
});
