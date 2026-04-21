#!/usr/bin/env node
// Seeds the two e2e test users into local Supabase and ensures each
// has a profiles row with the correct isAdmin flag. Idempotent: safe
// to run on every `npm run dev`. Uses SUPABASE_SECRET_KEY (local-only,
// baked into the Supabase CLI) to create/update users via the Admin
// API. CI never runs this — prod's two users are seeded by hand via
// the Supabase dashboard per docs/doc-supabase.md.

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

const USERS = [
  {
    email: "e2e-regular@testfake.local",
    envVar: "E2E_REGULAR_PASSWORD",
    isAdmin: false,
  },
  {
    email: "e2e-admin@testfake.local",
    envVar: "E2E_ADMIN_PASSWORD",
    isAdmin: true,
  },
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const dbUrl = process.env.DATABASE_URL;
const regularPw = process.env.E2E_REGULAR_PASSWORD;
const adminPw = process.env.E2E_ADMIN_PASSWORD;

// Local dev + local e2e: all vars set by `npm run setup`, so we seed.
// CI functional job: only DATABASE_URL is present (CI runs its own
// Supabase for vitest but doesn't touch auth). Skip silently so
// `npm run dev:db` stays usable as a shared prerequisite step.
if (!url || !secret || !regularPw || !adminPw) {
  process.stdout.write(
    "seed-e2e-users: skipping (auth/password env vars not set — expected in CI functional job)\n",
  );
  process.exit(0);
}
if (!dbUrl) {
  process.stderr.write("seed-e2e-users: DATABASE_URL is required\n");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false } });
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

try {
  const { data: list, error: listError } = await admin.auth.admin.listUsers();
  if (listError) {
    throw new Error(`listUsers failed: ${listError.message}`);
  }

  for (const user of USERS) {
    const password = process.env[user.envVar];
    const existing = list.users.find((u) => u.email === user.email);
    let userId;
    if (existing) {
      // Keep the password in sync with .env.local so rotating the
      // local value doesn't silently break the next e2e run.
      const { error } = await admin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
      });
      if (error) throw new Error(`update ${user.email}: ${error.message}`);
      userId = existing.id;
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: user.email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(`create ${user.email}: ${error?.message ?? "no user"}`);
      }
      userId = data.user.id;
    }

    // Pre-create the profiles row so the admin flag survives first
    // sign-in. ON CONFLICT preserves whatever fields prior runs left
    // behind (the reset endpoint handles per-run cleanup), but forces
    // is_admin to match the seed config.
    await sql`
      INSERT INTO profiles (id, is_admin)
      VALUES (${userId}, ${user.isAdmin})
      ON CONFLICT (id) DO UPDATE SET is_admin = ${user.isAdmin}
    `;

    process.stdout.write(
      `  seeded ${user.email} (is_admin=${user.isAdmin})\n`,
    );
  }
} finally {
  await sql.end();
}
