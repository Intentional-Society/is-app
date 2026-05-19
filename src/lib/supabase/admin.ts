import { createClient } from "@supabase/supabase-js";

import { supabaseUrl } from "./env";

// Privileged Supabase client for server-side Storage operations
// (signing, upload, delete). It authenticates with the secret key, so
// it bypasses Storage RLS — consistent with how `db` connects as a
// privileged Postgres role and treats RLS as a backstop. Server-only
// by placement and convention (like `src/server/db.ts`):
// SUPABASE_SECRET_KEY is not a NEXT_PUBLIC var, so it never reaches the
// client bundle. Do not import this into client code.
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!secretKey) {
  throw new Error("supabaseAdmin requires SUPABASE_SECRET_KEY to be set.");
}

export const supabaseAdmin = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
