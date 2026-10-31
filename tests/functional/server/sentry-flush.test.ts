import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
}));

// Real waitUntil no-ops outside Vercel; the spy records the promises a
// serverless instance would be kept alive for.
vi.mock(import("@vercel/functions"), async (importOriginal) => ({
  ...(await importOriginal()),
  waitUntil: vi.fn(),
}));

import { captureException as Sentry_captureException, flush as Sentry_flush } from "@sentry/nextjs";
import { createServerClient } from "@supabase/ssr";
import { waitUntil } from "@vercel/functions";

import { POST as authCallbackPost } from "@/app/auth/callback/route";
import { flushSentry } from "@/lib/sentry-flush";
import app from "@/server/api";

const mockCreateServerClient = vi.mocked(createServerClient);
const mockCapture = vi.mocked(Sentry_captureException);
const mockFlush = vi.mocked(Sentry_flush);
const mockWaitUntil = vi.mocked(waitUntil);

// requireAuth's getUser is the earliest point in every authed API
// request, so making it throw exercises a real thrown-handler path
// through the app.
const getUserReturns = (impl: () => Promise<unknown>) => {
  mockCreateServerClient.mockReturnValue({
    auth: { getUser: vi.fn().mockImplementation(impl) },
    // biome-ignore lint/suspicious/noExplicitAny: test mock shape
  } as any);
};

beforeEach(() => {
  mockCapture.mockClear();
  mockFlush.mockClear();
  mockFlush.mockResolvedValue(true);
  mockWaitUntil.mockClear();
});

describe("flushSentry", () => {
  it("swallows a failed flush instead of rejecting", async () => {
    mockFlush.mockRejectedValueOnce(new Error("network down"));
    flushSentry();
    await expect(mockWaitUntil.mock.calls[0][0]).resolves.toBe(false);
  });
});

describe("API request flushing", () => {
  it("flushes Sentry at the end of an ordinary request", async () => {
    getUserReturns(async () => ({ data: { user: null }, error: null }));
    const res = await app.request("/api/hello");
    expect(res.status).toBe(401);
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it("reports a thrown handler error to Sentry, then flushes it", async () => {
    const boom = new Error("getUser exploded");
    getUserReturns(async () => {
      throw boom;
    });
    const res = await app.request("/api/hello");
    expect(res.status).toBe(500);
    expect(mockCapture).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ extra: { method: "GET", path: "/api/hello" } }),
    );
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[0]);
  });

  // hono/validator throws an HTTPException on an unparseable body; that
  // is a client error and must stay a 400, not become a reported 500.
  it("keeps a malformed JSON body a 400 without reporting it", async () => {
    getUserReturns(async () => ({ data: { user: { id: randomUUID() } }, error: null }));
    const res = await app.request(`/api/relations/value/${randomUUID()}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(res.status).toBe(400);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe("auth callback flushing", () => {
  it("flushes Sentry when POST returns", async () => {
    const req = new NextRequest(new URL("/auth/callback", "http://testfake.local"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ type: "email" }).toString(),
    });
    const res = await authCallbackPost(req);
    expect(res.status).toBe(303);
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });
});
