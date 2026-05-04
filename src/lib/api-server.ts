import "server-only";

import { hc } from "hono/client";
import { cookies } from "next/headers";
import { cache } from "react";

import type { Me } from "@/lib/api-types";
import app, { type ApiRoutes } from "@/server/api";

// Server-side counterpart to `apiClient`. Calls the Hono app as a
// function (`app.fetch`) instead of going over HTTP, and forwards the
// caller's cookies so the API's auth middleware sees the same session.
//
// Origin is a placeholder — `hc` only uses it to construct request
// URLs, and the request is dispatched directly to the in-process
// Hono app, never to the network.
export const serverApiClient = hc<ApiRoutes>("http://server.local", {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore
      .getAll()
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ");

    const headers = new Headers(init?.headers);
    if (cookieHeader && !headers.has("cookie")) {
      headers.set("cookie", cookieHeader);
    }

    return app.fetch(new Request(input, { ...init, headers }));
  },
});

// Per-request memoized self-profile fetch. Layout and pages may both
// ask for the current user; cache() keys on the (empty) arg tuple so
// only one API call happens per render. The /api/me handler self-heals
// missing profile rows, so callers can treat a 200 as "authenticated".
export const loadMe = cache(async (): Promise<Me | null> => {
  const res = await serverApiClient.api.me.$get();
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Failed to load /api/me: ${res.status}`);
  return res.json();
});
