import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";
import { timed } from "@/lib/timing";

export async function proxy(request: NextRequest) {
  return timed(request, "proxy-total", () => updateSession(request));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
