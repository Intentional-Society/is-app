#!/usr/bin/env node
// Run Drizzle migrations quietly. Replaces `npx drizzle-kit migrate` on
// local dev paths. drizzle-kit prints config/driver chatter plus raw
// postgres NOTICEs (e.g. "schema already exists, skipping") on every
// warm run; here we use drizzle-orm's programmatic migrator with
// postgres' `onnotice` hook silenced so `npm run dev` stays quiet.

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  process.stderr.write(
    "DATABASE_URL is not set. Did you run `npm run setup`?\n",
  );
  process.exit(1);
}

const client = postgres(connectionString, {
  max: 1,
  onnotice: () => {},
});

try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
} finally {
  await client.end();
}
