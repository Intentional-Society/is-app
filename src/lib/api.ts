import { hc } from "hono/client";

import type { ApiRoutes } from "@/server/api";

export const apiClient = hc<ApiRoutes>("/", {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, credentials: "include" }),
});
