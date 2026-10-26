import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";
import { timed } from "@/lib/timing";

export async function proxy(request: NextRequest) {
  return timed(request, "proxy-total", () => updateSession(request));
}

// The version poll (docs/strategy-deployment.md) and the Sentry tunnel
// (/error-handling, tunnelRoute in next.config.ts) never use the session —
// exclude them from the proxy so they skip the per-request Supabase session
// refresh.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/version|error-handling|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
