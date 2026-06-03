import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { invites, profilePrograms, profiles, programs } from "../src/server/schema.js";

// Load .env.local so this script works standalone via `npx tsx`.
config({ path: resolve(process.cwd(), ".env.local") });

// Guard: refuse to run against anything other than local Supabase.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!supabaseUrl.includes("localhost") && !supabaseUrl.includes("127.0.0.1")) {
  throw new Error(
    `Refusing to seed: NEXT_PUBLIC_SUPABASE_URL is "${supabaseUrl}".\n` +
      `This script only runs against local Supabase (localhost / 127.0.0.1).`,
  );
}

// Use a single postgres client for both raw auth.users inserts and Drizzle.
// The DATABASE_URL connects as the postgres superuser which has access to auth schema.
const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

type SeedProfile = {
  id: string;
  email: string;
  displayName: string;
  bio: string | null;
  keywords: string[];
  location: string | null;
  referredBy: string | null;
  referredByLegacy: string | null;
  avatarUrl: string | null;
  emergencyContact: string | null;
  currentIntention: string | null;
  isAdmin: boolean;
  supplementaryInfo: string | null;
};
type SeedProgram = {
  id: string;
  slug: string;
  name: string;
  description: string;
};
type SeedProfilePrograms = { profileId: string; programId: string };
type SeedInvite = {
  id: string;
  code: string;
  createdBy: string;
  note: string;
  createdAt: string;
  expiresAt: string;
  redeemedBy: string | null;
  redeemedAt: string | null;
};
type SeedData = {
  profiles: SeedProfile[];
  programs: SeedProgram[];
  profilePrograms: SeedProfilePrograms[];
  invites: SeedInvite[];
};

// Load seed data relative to this file's location.
const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const seedData = JSON.parse(readFileSync(resolve(scriptDir, "seed-dev.json"), "utf-8")) as SeedData;

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
        is_sso_user, is_anonymous,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) VALUES (
        ${profile.id}::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated',
        'authenticated',
        ${profile.email},
        ${JSON.stringify({ provider: "email", providers: ["email"] })}::jsonb,
        ${JSON.stringify({ displayName: profile.displayName })}::jsonb,
        now(), now(), now(),
        false, false,
        '', '', '', ''
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (result.length > 0) inserted++;
    else skipped++;
  }
  return { inserted, skipped };
}

function toSlug(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function seedProfiles(): Promise<SeedResult> {
  // Stagger intention_updated_at across the members who have an intention
  // so the /intentions cloud has a real freshest-first ordering to render
  // (it z-orders and sizes by recency). ~1.5 days apart, newest first;
  // members without an intention get a null timestamp.
  const now = Date.now();
  let intentionRank = 0;
  const values = seedData.profiles.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    slug: p.displayName ? toSlug(p.displayName) : null,
    bio: p.bio,
    keywords: p.keywords,
    location: p.location,
    referredBy: p.referredBy,
    referredByLegacy: p.referredByLegacy,
    avatarUrl: p.avatarUrl,
    emergencyContact: p.emergencyContact,
    currentIntention: p.currentIntention,
    intentionUpdatedAt: p.currentIntention?.trim() ? new Date(now - intentionRank++ * 37 * 60 * 60 * 1000) : null,
    isAdmin: p.isAdmin,
    supplementaryInfo: p.supplementaryInfo,
  }));
  const result = await db.insert(profiles).values(values).onConflictDoNothing().returning({ id: profiles.id });
  return { inserted: result.length, skipped: values.length - result.length };
}

async function seedPrograms(): Promise<SeedResult> {
  // The column default for signups_open is false (closed-by-default for
  // newly-created programs), but the dev seed represents the live state
  // of running programs — they should be joinable without admin
  // intervention. Override here so a fresh seed isn't dead on arrival.
  const values = seedData.programs.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    signupsOpen: true,
  }));
  const result = await db.insert(programs).values(values).onConflictDoNothing().returning({ id: programs.id });
  return { inserted: result.length, skipped: values.length - result.length };
}

async function seedProfilePrograms(): Promise<SeedResult> {
  // Resolve program ids from the DB by slug rather than trusting the
  // JSON's hardcoded uuids. A program like weekly-web-updates can already
  // exist under a different id (slug is unique), in which case the
  // programs upsert above skipped the JSON row — so a membership pointing
  // at the JSON uuid would violate the FK. Mapping JSON uuid → slug → the
  // real db id keeps memberships attached to the program that actually
  // exists; any slug with no matching program is dropped, not fatal.
  const slugByJsonId = new Map(seedData.programs.map((p) => [p.id, p.slug]));
  const dbPrograms = await db.select({ id: programs.id, slug: programs.slug }).from(programs);
  const idBySlug = new Map(dbPrograms.map((p) => [p.slug, p.id]));

  const values = seedData.profilePrograms
    .map((pp) => {
      const slug = slugByJsonId.get(pp.programId);
      const programId = slug ? idBySlug.get(slug) : undefined;
      return programId ? { profileId: pp.profileId, programId } : null;
    })
    .filter((v): v is { profileId: string; programId: string } => v !== null);

  const result = await db
    .insert(profilePrograms)
    .values(values)
    .onConflictDoNothing()
    .returning({ profileId: profilePrograms.profileId });
  return { inserted: result.length, skipped: seedData.profilePrograms.length - result.length };
}

async function seedInvites(): Promise<SeedResult> {
  const values = seedData.invites.map((inv) => ({
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
  const result = await db.insert(invites).values(values).onConflictDoNothing().returning({ id: invites.id });
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
