import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL ??
  (() => {
    throw new Error("DATABASE_URL is not set");
  })();

// Cache the postgres-js client on globalThis in dev so HMR module
// reloads reuse the same pool instead of leaking a fresh ~10-connection
// pool every time `src/server/db.ts` is re-evaluated. Without this the
// dev DB exhausts max_connections after a few dozen edits and starts
// rejecting new sessions with "remaining connection slots are reserved
// for roles with the SUPERUSER attribute". In production the
// globalThis branch is bypassed, so a single fresh client is created
// once at process start as usual.
declare global {
  // globalThis augmentation requires `var` — `let`/`const` don't declare a global.
  var __pgClient: ReturnType<typeof postgres> | undefined;
}

// `prepare: false` — kept deliberately. Supavisor's transaction-pooler
// prepared-statement support is only "partial" (Supabase FAQ +
// supavisor#239); dropping prepared statements removes a plausible #149
// aggravator (postgres-js re-preparing against rotating backends) at no
// measured cost — Supavisor emulates them anyway. A 2026-06 audit of the
// auth-callback redemption path found zero #149 occurrences in prod under
// this setting, so we keep it rather than re-introduce the variable.
// See docs/strategy-db-transactions.md.
const client = globalThis.__pgClient ?? postgres(connectionString, { prepare: false });
if (process.env.NODE_ENV !== "production") {
  globalThis.__pgClient = client;
}

export const db = drizzle(client);
