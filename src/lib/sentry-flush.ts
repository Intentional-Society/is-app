import { flush as Sentry_flush } from "@sentry/nextjs";
import { waitUntil } from "@vercel/functions";

// Sentry's capture calls only queue an event; the SDK sends it on a
// later tick. @sentry/nextjs flushes that queue at response end only
// inside the route handlers it wraps, and the Turbopack build wraps none,
// so a frozen serverless instance silently drops every queued event — the
// same failure next-axiom had (docs/doc-sentry.md). Call this at the end
// of any server entry point that may have captured something. waitUntil
// keeps the instance alive until delivery without delaying the response;
// outside Vercel it no-ops and the long-lived process sends on its own.
const FLUSH_TIMEOUT_MS = 2000;

export const flushSentry = (): void => {
  // Flush failures must never surface as an unhandled rejection; the
  // event is lost either way.
  waitUntil(Sentry_flush(FLUSH_TIMEOUT_MS).catch(() => false));
};
