import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { timed } from "@/lib/timing";

import { supabasePublishableKey, supabaseUrl } from "./env";
import { encodeUser, SUPABASE_USER_HEADER } from "./server-user";

type CookieToSet = { name: string; value: string; options: Record<string, unknown> };

export const updateSession = async (request: NextRequest) => {
  // Drop any inbound value before validation. Only the post-getUser
  // branch below is allowed to write SUPABASE_USER_HEADER, so external
  // callers cannot forge an authenticated identity by sending the
  // header themselves.
  request.headers.delete(SUPABASE_USER_HEADER);

  const cookieUpdates: CookieToSet[] = [];

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const c of cookiesToSet) {
          // Mutate request.cookies so Server Components called later
          // in this same render see the refreshed token.
          request.cookies.set(c.name, c.value);
          cookieUpdates.push(c);
        }
      },
    },
  });

  const {
    data: { user },
  } = await timed(request, "supabase-auth-getUser", () => supabase.auth.getUser());

  if (user) {
    request.headers.set(SUPABASE_USER_HEADER, encodeUser(user));
  }

  // Build the final response once. NextResponse.next forwards
  // request.headers (including the user header and refreshed Cookie
  // header) to the downstream handler.
  const response = NextResponse.next({ request: { headers: request.headers } });
  for (const c of cookieUpdates) {
    response.cookies.set(c.name, c.value, c.options);
  }
  return response;
};
