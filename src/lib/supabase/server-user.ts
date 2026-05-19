import type { User } from "@supabase/supabase-js";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";

// Header carrying the proxy-authed User down to Server Components and
// to the in-process Hono API. The proxy (src/lib/supabase/middleware.ts)
// strips any inbound value before validating the session, then sets
// this header to the validated User on the forwarded request. Code
// inside the request can therefore trust the header without making a
// second supabase.auth.getUser() round-trip.
export const SUPABASE_USER_HEADER = "x-supabase-user";

export const encodeUser = (user: User): string => Buffer.from(JSON.stringify(user), "utf8").toString("base64");

export const decodeUser = (encoded: string | null | undefined): User | null => {
  if (!encoded) return null;
  try {
    const json = Buffer.from(encoded, "base64").toString("utf8");
    return JSON.parse(json) as User;
  } catch {
    return null;
  }
};

// Server-Component-side reader. Trusts SUPABASE_USER_HEADER on the
// incoming request when present; otherwise falls back to a fresh
// supabase.auth.getUser() — needed only on proxy-excluded paths and in
// tests that bypass the proxy. In normal signed-in traffic the
// fallback never runs.
export const getServerUser = async (): Promise<User | null> => {
  const fromHeader = decodeUser((await headers()).get(SUPABASE_USER_HEADER));
  if (fromHeader) return fromHeader;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
};
