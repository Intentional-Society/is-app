import {
  captureRouterTransitionStart as Sentry_captureRouterTransitionStart,
  init as Sentry_init,
  replayIntegration as Sentry_replayIntegration,
} from "@sentry/nextjs";

import { scrubClientEvent } from "@/lib/sentry-scrub";

// Session replay is opt-in for support sessions: load any page with
// ?debug-replay=1 and the rest of the browser session records (masked text,
// no media). The flag sticks in sessionStorage so it survives in-app
// navigation but ends when the tab closes.
const debugReplay = (() => {
  try {
    if (new URLSearchParams(window.location.search).has("debug-replay")) {
      window.sessionStorage.setItem("debug-replay", "1");
    }
    return window.sessionStorage.getItem("debug-replay") === "1";
  } catch {
    // sessionStorage can throw when the user blocks site data
    return false;
  }
})();

Sentry_init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Report from production deploys only: preview e2e runs were sending
  // thousands of tunnel POSTs per run (Vercel traffic-spike alerts), and
  // local dev errors are already on the developer's screen.
  // NEXT_PUBLIC_VERCEL_ENV is inlined via the env key in next.config.ts.
  enabled: process.env.NEXT_PUBLIC_VERCEL_ENV === "production",
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: debugReplay ? 1.0 : 0,
  replaysOnErrorSampleRate: debugReplay ? 1.0 : 0,
  integrations: debugReplay
    ? [
        Sentry_replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ]
    : [],
  beforeSend: scrubClientEvent,
});

export const onRouterTransitionStart = Sentry_captureRouterTransitionStart;
