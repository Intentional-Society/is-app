import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

// GET is intentional: a member can type /logout into the URL bar.
// The CSRF exposure (a cross-site <img src="/logout">) is low-impact —
// worst case the member gets signed out and signs back in.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url));
}
