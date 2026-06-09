import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { invites, profilePrograms, profiles, programs, relations } from "../src/server/schema.js";

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

// The first seed member (Aria Chen) doubles as a durable demo account: the
// rich web is built around her (seedRelations) and a dev-only password is
// set so the /signin dev panel can log in as her. She's an ordinary seed
// profile, so the e2e reset — which only touches the two e2e users — never
// disturbs her web. Password is the literal "password"; local-only, guarded
// by the localhost check above.
const DEMO = {
  id: seedData.profiles[0].id,
  email: seedData.profiles[0].email,
  password: "password",
};

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

  // Dev-only: give the demo account a known bcrypt password so the /signin
  // dev panel can sign in as her. The 39 other seed members keep their null
  // password and remain non-loginable.
  await client`
    UPDATE auth.users
    SET encrypted_password = crypt(${DEMO.password}, gen_salt('bf'))
    WHERE id = ${DEMO.id}::uuid
  `;

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

// Build a relational web centered on the demo account (Aria, members[0]) so
// signing in as her and opening /myweb lands on a populated graph:
//
//   - Aria → 30 of the other 39 members. Relationship depth (the 1..4 value
//     — Acquaintance/Friend/Close Friend/Kin per design-relations.md) is
//     cycled across the 30 so all four rungs are represented.
//   - 5 of those 30 act as hubs, each relating to 15 members: the 9 "outer"
//     members Aria is NOT directly tied to (so the 2-hop view pulls them
//     in), plus a rotating window of 6 inner first-degree peers (cross-links
//     within the inner ring). Hubs are first-degree to Aria, so their
//     relations surface as the second ring when the "Friends-of-friends" toggle is on.
//
// All rows are confirmed relations (isHint=false, value 1..4) among seed
// profiles only, so the e2e reset never disturbs them. Idempotent via
// onConflictDoNothing.
async function seedRelations(): Promise<SeedResult> {
  const members = seedData.profiles; // 40 seed members; members[0] = Aria (center)
  const CENTER_DEGREE = 30;
  const HUB_COUNT = 5;
  const HUB_DEGREE = 15;

  // Cycle relationship depth 1..4 across a relatee list so every rung shows.
  const depthFor = (i: number) => (i % 4) + 1;

  const center = members[0];
  const rows: { relatorId: string; relateeId: string; value: number; isHint: boolean }[] = [];

  // Aria → the next 30 members (her first-degree ring, indices 1..30).
  const firstDegree = members.slice(1, 1 + CENTER_DEGREE);
  for (const [i, m] of firstDegree.entries()) {
    rows.push({ relatorId: center.id, relateeId: m.id, value: depthFor(i), isHint: false });
  }

  // 5 hubs (indices 1..5, all first-degree to Aria) → 15 each. Every hub
  // reaches all 9 "outer" members (indices 31..39) so the 2-hop view brings
  // them in; each hub also links a rotating window of 6 inner peers drawn
  // from the rest of the first-degree ring (indices 6..30).
  const outer = members.slice(1 + CENTER_DEGREE); // 9 members
  const innerPool = members.slice(1 + HUB_COUNT, 1 + CENTER_DEGREE); // 25 members (indices 6..30)
  const innerCount = HUB_DEGREE - outer.length; // 6
  for (let h = 0; h < HUB_COUNT; h++) {
    const hub = members[1 + h];
    const inner = Array.from({ length: innerCount }, (_, j) => innerPool[(h * innerCount + j) % innerPool.length]);
    const relatees = [...outer, ...inner];
    for (const [k, m] of relatees.entries()) {
      if (m.id === hub.id) continue; // defensive; windows never include the hubs
      rows.push({ relatorId: hub.id, relateeId: m.id, value: depthFor(k), isHint: false });
    }
  }

  const result = await db
    .insert(relations)
    .values(rows)
    .onConflictDoNothing()
    .returning({ relatorId: relations.relatorId });

  // Finish making Aria a sign-in-ready demo: mark onboarding complete (so
  // sign-in skips /welcome — see welcomeEntryStep) and bump last_updated_web
  // so /myweb opens in View mode (the square canvas).
  const now = new Date();
  await db
    .update(profiles)
    .set({
      lastSignedAgreements: now,
      lastUpdatedProfile: now,
      lastReviewedPrograms: now,
      lastUpdatedWeb: now,
    })
    .where(eq(profiles.id, center.id));

  return { inserted: result.length, skipped: rows.length - result.length };
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

  const relationResult = await seedRelations();
  logResult("relations:", relationResult);

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message);
  process.exit(1);
});
