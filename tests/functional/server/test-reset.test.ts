// The e2e reset endpoint's gate and request validation. What a reset
// writes is exercised by every e2e run (its read-back tripwire fails
// the run when a profile doesn't match), not here: these tests stop
// before the database, because the rows a reset touches belong to the
// seeded e2e accounts that a concurrent e2e run is using.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import app from "@/server/api";
import { parseResetRequest } from "@/server/test-reset";

describe("parseResetRequest", () => {
  it("resets every account to fresh when there is no body", () => {
    expect(parseResetRequest(undefined)).toEqual({ accounts: ["regular", "admin"], state: "fresh" });
    expect(parseResetRequest({})).toEqual({ accounts: ["regular", "admin"], state: "fresh" });
  });

  it("narrows to one account", () => {
    expect(parseResetRequest({ account: "admin" })).toEqual({ accounts: ["admin"], state: "fresh" });
  });

  it("takes the state to leave the accounts in", () => {
    expect(parseResetRequest({ account: "regular", state: "onboarded" })).toEqual({
      accounts: ["regular"],
      state: "onboarded",
    });
    expect(parseResetRequest({ state: "onboarded" })).toEqual({ accounts: ["regular", "admin"], state: "onboarded" });
  });

  it("rejects an account that isn't a seeded e2e account", () => {
    // The key is the only way to name a target, so nothing but the
    // seeded accounts can be reset — not an email, not a profile id.
    expect(parseResetRequest({ account: "someone@example.com" })).toEqual({
      error: "account must be one of: regular, admin",
    });
    expect(parseResetRequest({ account: ["regular"] })).toHaveProperty("error");
  });

  it("rejects an unknown state", () => {
    expect(parseResetRequest({ state: "deleted" })).toEqual({ error: "state must be one of: fresh, onboarded" });
  });

  it("rejects a body that isn't an object", () => {
    expect(parseResetRequest("regular")).toEqual({ error: "body must be a JSON object" });
    expect(parseResetRequest(["regular"])).toEqual({ error: "body must be a JSON object" });
  });
});

describe("POST /api/_test/reset", () => {
  const TOKEN = "test-reset-token";
  const originalToken = process.env.CI_RESET_TOKEN;

  beforeEach(() => {
    process.env.CI_RESET_TOKEN = TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.CI_RESET_TOKEN;
    else process.env.CI_RESET_TOKEN = originalToken;
  });

  const post = (headers: Record<string, string>, body?: string) =>
    app.request("/api/_test/reset", { method: "POST", headers, body });

  it("404s without the token header", async () => {
    const res = await post({});
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("404s on a wrong token", async () => {
    const res = await post({ "x-ci-reset-token": "not-the-token" });
    expect(res.status).toBe(404);
  });

  it("404s when the server has no token configured, even if the header is empty too", async () => {
    delete process.env.CI_RESET_TOKEN;
    const res = await post({ "x-ci-reset-token": "" });
    expect(res.status).toBe(404);
  });

  it("400s on a body that isn't JSON", async () => {
    const res = await post({ "x-ci-reset-token": TOKEN }, "{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid JSON" });
  });

  it("400s on an account outside the seeded set", async () => {
    const res = await post({ "x-ci-reset-token": TOKEN }, JSON.stringify({ account: "everyone" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "account must be one of: regular, admin" });
  });

  it("400s on an unknown state", async () => {
    const res = await post({ "x-ci-reset-token": TOKEN }, JSON.stringify({ account: "regular", state: "admin" }));
    expect(res.status).toBe(400);
  });
});
