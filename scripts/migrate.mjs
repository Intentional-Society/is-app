#!/usr/bin/env node
// Run Drizzle migrations. Local dev paths stay quiet (drizzle-kit otherwise
// prints driver chatter and postgres NOTICEs on every warm run). In CI / when
// MIGRATE_VERBOSE is set it narrates instead — which database it reached, how
// many migrations were pending, and how many actually persisted — so a prod
// migration that silently does nothing leaves a trail in the Actions log.

import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  process.stderr.write("DATABASE_URL is not set. Did you run `npm run setup`?\n");
  process.exit(1);
}

const verbose = !!(process.env.MIGRATE_VERBOSE || process.env.CI);
const log = (msg) => verbose && process.stderr.write(`[migrate] ${msg}\n`);

// Connection summary with credentials stripped. The port reveals the pooler
// mode: 6543 = transaction pooler (multi-statement txns can be silently
// mishandled), 5432 = session/direct (sound). First thing we want to confirm.
try {
  const u = new URL(connectionString);
  const mode = u.port === "6543" ? "transaction pooler" : u.port === "5432" ? "session/direct" : "unknown";
  log(`target ${u.hostname}:${u.port || "?"} db=${u.pathname.slice(1)} (${mode})`);
} catch {
  log("DATABASE_URL is not a parseable URL — skipping target summary");
}

const client = postgres(connectionString, {
  max: 1,
  // Forward postgres NOTICE/WARNING when narrating; swallow on quiet local runs.
  onnotice: verbose ? (n) => log(`pg notice: ${n.message ?? n}`) : () => {},
  // migrate() has no verbose option, so log at the driver instead: this fires
  // on every statement over the wire, showing the BEGIN/ALTER/COMMIT the
  // migrator actually issues — and whether the DDL is sent at all.
  debug: verbose ? (_connection, query) => log(`sql: ${query.replace(/\s+/g, " ").trim()}`) : undefined,
});
const db = drizzle(client);

// Count drizzle's own bookkeeping rows before and after. Comparing against the
// journal's total proves what *persisted* — independent of what migrate()
// claims. A pending migration that doesn't grow this count is a silent discard.
const appliedCount = async () => {
  try {
    const rows = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    return rows[0].n;
  } catch (e) {
    log(`could not read __drizzle_migrations (first run?): ${e.message}`);
    return 0;
  }
};

try {
  let before = 0;
  if (verbose) {
    const total = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")).entries.length;
    before = await appliedCount();
    log(`journal has ${total} migrations; ${before} applied, ${total - before} pending`);

    await migrate(db, { migrationsFolder: "./drizzle" });
    log("migrate() returned without throwing");

    const after = await appliedCount();
    if (after === before && after < total) {
      log(
        `WARNING: migrate() reported success but applied count is still ${after} — ${total - after} migration(s) did NOT persist.`,
      );
    } else {
      log(`applied ${after - before} migration(s); ${after}/${total} now recorded.`);
    }
  } else {
    await migrate(db, { migrationsFolder: "./drizzle" });
  }
} catch (e) {
  if (verbose) process.stderr.write(`[migrate] FAILED: ${e.message}\n${e.stack ?? ""}\n`);
  throw e;
} finally {
  await client.end();
}
