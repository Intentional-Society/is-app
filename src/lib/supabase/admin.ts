import { createClient } from "@supabase/supabase-js";

// Privileged Supabase client for server-side Storage operations
// (signing, upload, delete). It authenticates with the secret key, so
// it bypasses Storage RLS — consistent with how `db` connects as a
// privileged Postgres role and treats RLS as a backstop. Server-only
// by placement and convention (like `src/server/db.ts`):
// SUPABASE_SECRET_KEY is not a NEXT_PUBLIC var, so it never reaches the
// client bundle. Do not import this into client code.
export const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
