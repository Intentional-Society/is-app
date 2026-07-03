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

// `prepare: false` — adopted as a #149 isolation experiment (#296). The A/B
// answered "not a factor": the #149 failure signature continued unchanged
// until the real fix (#358, e2e run serialization). Kept because it costs
// nothing — Supavisor emulates prepared statements on the transaction pooler
// anyway (Supabase FAQ + supavisor#239) — and reverting would re-introduce a
// variable for no measured gain. See docs/strategy-db-transactions.md.
const client = globalThis.__pgClient ?? postgres(connectionString, { prepare: false });
if (process.env.NODE_ENV !== "production") {
  globalThis.__pgClient = client;
}

export const db = drizzle(client);
