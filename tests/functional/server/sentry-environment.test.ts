import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { E2E_ENVIRONMENT, isE2eUserAgent, tagE2eServerEvent } from "@/lib/sentry-environment";

const HEADLESS_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36";
const MEMBER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

const makeEvent = (request: ErrorEvent["request"]): ErrorEvent =>
  ({ environment: "vercel-production", request }) as ErrorEvent;

describe("isE2eUserAgent", () => {
  it("matches Playwright's headless Chromium", () => {
    expect(isE2eUserAgent(HEADLESS_UA)).toBe(true);
  });

  it("does not match a member's desktop Chrome", () => {
    expect(isE2eUserAgent(MEMBER_UA)).toBe(false);
  });

  it("does not match a missing user agent", () => {
    expect(isE2eUserAgent(undefined)).toBe(false);
  });
});

describe("tagE2eServerEvent", () => {
  it("moves a headless-Chromium request's event to the e2e environment", () => {
    const result = tagE2eServerEvent(makeEvent({ headers: { "user-agent": HEADLESS_UA } }));

    expect(result.environment).toBe(E2E_ENVIRONMENT);
  });

  it("leaves a member request's event in its environment", () => {
    const result = tagE2eServerEvent(makeEvent({ headers: { "user-agent": MEMBER_UA } }));

    expect(result.environment).toBe("vercel-production");
  });

  it("leaves an event without request data in its environment", () => {
    const result = tagE2eServerEvent({ environment: "vercel-production" } as ErrorEvent);

    expect(result.environment).toBe("vercel-production");
  });
});
