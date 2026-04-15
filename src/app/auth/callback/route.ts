import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { upsertProfile } from "@/server/profiles";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=missing_code", request.url),
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(
      new URL("/login?error=exchange_failed", request.url),
    );
  }

  try {
    await upsertProfile(data.user);
  } catch {
    // Session is still valid; next sign-in self-heals via the
    // idempotent upsert.
    return NextResponse.redirect(
      new URL("/login?error=profile_error", request.url),
    );
  }

  return NextResponse.redirect(new URL("/", request.url));
}
