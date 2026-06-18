import { describe, expect, it } from "vitest";

import { appVersion, urgentReleasedAt } from "@/lib/changelog";
import app from "@/server/api";

describe("GET /api/version", () => {
  it("reports the deploy identity without a session", async () => {
    // No auth header or cookie: the route is on the PUBLIC_PATHS
    // allowlist, so an idle or signed-out tab can still poll it. A 401
    // here would mean it slipped behind requireAuth.
    const res = await app.request("/api/version");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      // VERCEL_DEPLOYMENT_ID is unset outside a Vercel deploy, so the id
      // falls back to the "dev" sentinel — matching NEXT_PUBLIC_BUILD_ID
      // locally, where there is only ever one "deployment".
      id: "dev",
      appVersion,
      urgentReleasedAt,
    });
  });
});
