import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { scrubClientEvent, scrubServerEvent } from "@/lib/sentry-scrub";

const makeEvent = (request: ErrorEvent["request"]): ErrorEvent =>
  ({ request }) as ErrorEvent;

describe("scrubClientEvent", () => {
  it("strips the query string from /auth/callback URLs", () => {
    const event = makeEvent({
      url: "https://app.example/auth/callback?code=secret-token&invite=ABC",
      query_string: "code=secret-token&invite=ABC",
    });

    const result = scrubClientEvent(event);

    expect(result.request?.url).toBe("https://app.example/auth/callback");
    expect(result.request?.query_string).toBeUndefined();
  });

  it("strips the query string from /login URLs", () => {
    const event = makeEvent({
      url: "https://app.example/login?redirect=/dashboard",
      query_string: "redirect=/dashboard",
    });

    const result = scrubClientEvent(event);

    expect(result.request?.url).toBe("https://app.example/login");
    expect(result.request?.query_string).toBeUndefined();
  });

  it("strips the query string from /signup URLs", () => {
    const event = makeEvent({
      url: "https://app.example/signup?invite=XYZ",
    });

    const result = scrubClientEvent(event);

    expect(result.request?.url).toBe("https://app.example/signup");
  });

  it("preserves URLs and query strings on non-auth routes", () => {
    const event = makeEvent({
      url: "https://app.example/dashboard?tab=invites",
      query_string: "tab=invites",
    });

    const result = scrubClientEvent(event);

    expect(result.request?.url).toBe("https://app.example/dashboard?tab=invites");
    expect(result.request?.query_string).toBe("tab=invites");
  });

  it("returns the event unchanged when request is missing", () => {
    const event = { message: "boom" } as ErrorEvent;

    const result = scrubClientEvent(event);

    expect(result).toBe(event);
  });

  it("returns events from auth routes (does not drop them)", () => {
    const event = makeEvent({
      url: "https://app.example/auth/callback?code=x",
    });

    const result = scrubClientEvent(event);

    expect(result).not.toBeNull();
    expect(result.request).toBeDefined();
  });
});

describe("scrubServerEvent", () => {
  it("removes cookies, authorization, and cookie headers", () => {
    const event = makeEvent({
      cookies: { "sb-access-token": "secret" },
      headers: {
        authorization: "Bearer secret-token",
        cookie: "sb-access-token=secret",
        "user-agent": "Mozilla/5.0",
      },
    });

    const result = scrubServerEvent(event);

    expect(result.request?.cookies).toBeUndefined();
    expect(result.request?.headers?.["authorization"]).toBeUndefined();
    expect(result.request?.headers?.["cookie"]).toBeUndefined();
  });

  it("preserves non-sensitive headers", () => {
    const event = makeEvent({
      headers: {
        authorization: "Bearer x",
        "user-agent": "Mozilla/5.0",
        "x-request-id": "abc-123",
      },
    });

    const result = scrubServerEvent(event);

    expect(result.request?.headers?.["user-agent"]).toBe("Mozilla/5.0");
    expect(result.request?.headers?.["x-request-id"]).toBe("abc-123");
  });

  it("is a no-op when request is missing", () => {
    const event = { message: "boom" } as ErrorEvent;

    const result = scrubServerEvent(event);

    expect(result).toBe(event);
  });

  it("handles a request with no headers", () => {
    const event = makeEvent({ cookies: { x: "y" } });

    const result = scrubServerEvent(event);

    expect(result.request?.cookies).toBeUndefined();
  });
});
