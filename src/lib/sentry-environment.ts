import type { ErrorEvent } from "@sentry/nextjs";

// The post-deploy e2e suite runs Playwright's headless Chromium against
// production, which identifies itself as HeadlessChrome. Its telemetry
// reports under its own environment so member data in vercel-production
// stays separate from synthetic runs.
export const E2E_ENVIRONMENT = "e2e";

export const isE2eUserAgent = (userAgent: string | undefined): boolean =>
  userAgent?.includes("HeadlessChrome") ?? false;

// The server SDK sets one environment per process, so e2e requests are
// told apart per event, by the user agent the request data carries.
export const tagE2eServerEvent = (event: ErrorEvent): ErrorEvent => {
  if (isE2eUserAgent(event.request?.headers?.["user-agent"])) {
    event.environment = E2E_ENVIRONMENT;
  }
  return event;
};
