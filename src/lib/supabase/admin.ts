import "server-only";

import { createClient } from "@supabase/supabase-js";

// Privileged Supabase client for server-side Storage operations
// (signing, upload, delete). It authenticates with the secret key, so
// it bypasses Storage RLS — consistent with how `db` connects as a
// privileged Postgres role and treats RLS as a backstop. Never import
// this into client code; the `server-only` guard fails the build if
// something tries.
export const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
