import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";
import { timed } from "@/lib/timing";

export async function proxy(request: NextRequest) {
  return timed(request, "proxy-total", () => updateSession(request));
}

// The version poll (docs/strategy-deployment.md) is a frequent, public,
// unauthenticated request — exclude it from the proxy so it skips the
// per-request Supabase session refresh. (Same reason /api/health was
// excluded before it was removed.)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/version|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
