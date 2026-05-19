// Validated Supabase connection values, shared by every Supabase client
// (browser, server, middleware, Hono auth fallback).
//
// The `process.env.NEXT_PUBLIC_*` reads stay literal so Next.js still
// inlines them into the client bundle at build time. The only thing
// this module adds is a fail-fast, named error — instead of letting an
// `undefined` flow into a Supabase client and surface as a confusing
// failure much later.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (!url || !publishableKey) {
  throw new Error(
    "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY must be set.",
  );
}

export const supabaseUrl = url;
export const supabasePublishableKey = publishableKey;
