import { config } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  profiles,
  programs,
  profilePrograms,
  invites,
} from "../src/server/schema.js";

// Load .env.local so this script works standalone via `npx tsx`.
config({ path: resolve(process.cwd(), ".env.local") });

// Guard: refuse to run against anything other than local Supabase.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!supabaseUrl.includes("localhost") && !supabaseUrl.includes("127.0.0.1")) {
  throw new Error(
    `Refusing to seed: NEXT_PUBLIC_SUPABASE_URL is "${supabaseUrl}".\n` +
      `This script only runs against local Supabase (localhost / 127.0.0.1).`
  );
}

// Use a single postgres client for both raw auth.users inserts and Drizzle.
// The DATABASE_URL connects as the postgres superuser which has access to auth schema.
const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

// Load seed data relative to this file's location.
const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const seedData = JSON.parse(
  readFileSync(resolve(scriptDir, "seed-dev.json"), "utf-8")
);

type SeedResult = { inserted: number; skipped: number };

async function seedAuthUsers(): Promise<SeedResult> {
  let inserted = 0;
  let skipped = 0;
  for (const profile of seedData.profiles) {
    const result = await client`
      INSERT INTO auth.users (
        id, instance_id, aud, role, email,
        raw_app_meta_data, raw_user_meta_data,
        email_confirmed_at, created_at, updated_at,
        is_sso_user, is_anonymous
      ) VALUES (
        ${profile.id}::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated',
        'authenticated',
        ${profile.email},
        ${JSON.stringify({ provider: "email", providers: ["email"] })}::jsonb,
        ${JSON.stringify({ displayName: profile.displayName })}::jsonb,
        now(), now(), now(),
        false, false
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (result.length > 0) inserted++;
    else skipped++;
  }
  return { inserted, skipped };
}

async function seedProfiles(): Promise<SeedResult> {
  const values = seedData.profiles.map((p: any) => ({
    id: p.id,
    displayName: p.displayName,
    bio: p.bio,
    keywords: p.keywords,
    location: p.location,
    referredBy: p.referredBy,
    referredByLegacy: p.referredByLegacy,
    avatarUrl: p.avatarUrl,
    emergencyContact: p.emergencyContact,
    liveDesire: p.liveDesire,
    isAdmin: p.isAdmin,
    supplementaryInfo: p.supplementaryInfo,
  }));
  const result = await db
    .insert(profiles)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: profiles.id });
  return { inserted: result.length, skipped: values.length - result.length };
}

async function seedPrograms(): Promise<SeedResult> {
  const values = seedData.programs.map((p: any) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
  }));
  const result = await db
    .insert(programs)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: programs.id });
  return { inserted: result.length, skipped: values.length - result.length };
}

async function seedProfilePrograms(): Promise<SeedResult> {
  const values = seedData.profilePrograms.map((pp: any) => ({
    profileId: pp.profileId,
    programId: pp.programId,
  }));
  const result = await db
    .insert(profilePrograms)
    .values(values)
    .onConflictDoNothing()
    .returning({ profileId: profilePrograms.profileId });
  return { inserted: result.length, skipped: values.length - result.length };
}

async function seedInvites(): Promise<SeedResult> {
  const values = seedData.invites.map((inv: any) => ({
    id: inv.id,
    code: inv.code,
    createdBy: inv.createdBy,
    note: inv.note,
    createdAt: new Date(inv.createdAt),
    expiresAt: new Date(inv.expiresAt),
    redeemedBy: inv.redeemedBy ?? null,
    redeemedAt: inv.redeemedAt ? new Date(inv.redeemedAt) : null,
    revokedAt: null,
  }));
  const result = await db
    .insert(invites)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: invites.id });
  return { inserted: result.length, skipped: values.length - result.length };
}

function logResult(label: string, result: SeedResult) {
  const padded = label.padEnd(22);
  console.log(`  ${padded}${result.inserted} inserted, ${result.skipped} skipped`);
}

async function main() {
  console.log(`\nSeeding local database at ${supabaseUrl}...\n`);

  const authResult = await seedAuthUsers();
  logResult("auth users:", authResult);

  const profileResult = await seedProfiles();
  logResult("profiles:", profileResult);

  const programResult = await seedPrograms();
  logResult("programs:", programResult);

  const membershipResult = await seedProfilePrograms();
  logResult("profile_programs:", membershipResult);

  const inviteResult = await seedInvites();
  logResult("invites:", inviteResult);

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message);
  process.exit(1);
});
