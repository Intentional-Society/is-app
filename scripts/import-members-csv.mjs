#!/usr/bin/env node
/**
 * Import IS member data from a CSV export of the Google Sheet signup form.
 *
 * Usage:
 *   node scripts/import-members-csv.mjs path/to/members.csv
 *   node scripts/import-members-csv.mjs path/to/members.csv --dry-run
 *
 * Required env vars (same as the app):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 *   DATABASE_URL
 *
 * Column mapping:
 *   Edit COLUMN_MAP below to match your CSV headers. Keys are profile
 *   field names; values are the exact CSV column header strings.
 *   Set a value to null to skip that field.
 *
 * Idempotency:
 *   - Auth users are created with createUser if they don't exist, or
 *     looked up by email if they do. Re-running is safe.
 *   - Profile rows use INSERT ... ON CONFLICT DO UPDATE so edits to
 *     the CSV and re-running will overwrite previous imports.
 *   - Rows with no email are skipped with a warning.
 *
 * Photos:
 *   Google Form saves photos to Google Drive. Downloading and uploading
 *   them to Supabase Storage requires the Google Drive API and is not
 *   handled here. See docs/doc-email.md for the planned approach.
 *   The avatarUrl column in the CSV (if present) is imported as-is
 *   and should be a publicly accessible URL or a Supabase Storage path.
 */

import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

// ---------------------------------------------------------------------------
// Column mapping — edit these to match your CSV export headers exactly.
// Set to null to skip the field.
// ---------------------------------------------------------------------------
const COLUMN_MAP = {
  email: "Email Address",
  displayName: "Full Name",
  bio: "Tell us about yourself",
  location: "Where are you based?",
  keywords: "Keywords / Interests", // comma-separated within the cell
  liveDesire: "What is your live desire?",
  emergencyContact: "Emergency contact",
  supplementaryInfo: "Anything else?",
  avatarUrl: null, // set to a column header if the CSV has avatar URLs
};
// ---------------------------------------------------------------------------

const csvPath = process.argv[2];
const isDryRun = process.argv.includes("--dry-run");

if (!csvPath) {
  console.error("Usage: node scripts/import-members-csv.mjs <path-to-csv> [--dry-run]");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const dbUrl = process.env.DATABASE_URL;

if (!url || !secret || !dbUrl) {
  console.error("Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, DATABASE_URL");
  process.exit(1);
}

if (isDryRun) {
  console.log("\n[DRY RUN] No changes will be written.\n");
}

const admin = createClient(url, secret, { auth: { persistSession: false } });
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

// ---------------------------------------------------------------------------
// CSV parsing — handles quoted fields and commas inside quotes.
// ---------------------------------------------------------------------------
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

async function parseCSV(filePath) {
  const rows = [];
  const rl = createInterface({ input: createReadStream(resolve(filePath)), crlfDelay: Infinity });
  let headers = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cells = parseCSVLine(line);
    if (!headers) {
      headers = cells.map((h) => h.trim());
    } else {
      const row = {};
      headers.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
      rows.push(row);
    }
  }
  return rows;
}

function toSlug(displayName) {
  return displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nImporting members from: ${csvPath}`);
  console.log(`Target: ${url}\n`);

  const rows = await parseCSV(csvPath);
  console.log(`Found ${rows.length} rows in CSV.\n`);

  const stats = { created: 0, updated: 0, skipped: 0, errors: 0 };

  for (const row of rows) {
    const email = COLUMN_MAP.email ? row[COLUMN_MAP.email]?.toLowerCase().trim() : null;
    if (!email) {
      console.warn(`  SKIP  — no email in row: ${JSON.stringify(row)}`);
      stats.skipped++;
      continue;
    }

    const displayName = COLUMN_MAP.displayName ? row[COLUMN_MAP.displayName] || null : null;
    const bio = COLUMN_MAP.bio ? row[COLUMN_MAP.bio] || null : null;
    const location = COLUMN_MAP.location ? row[COLUMN_MAP.location] || null : null;
    const liveDesire = COLUMN_MAP.liveDesire ? row[COLUMN_MAP.liveDesire] || null : null;
    const emergencyContact = COLUMN_MAP.emergencyContact ? row[COLUMN_MAP.emergencyContact] || null : null;
    const supplementaryInfo = COLUMN_MAP.supplementaryInfo ? row[COLUMN_MAP.supplementaryInfo] || null : null;
    const avatarUrl = COLUMN_MAP.avatarUrl ? row[COLUMN_MAP.avatarUrl] || null : null;
    const keywords = COLUMN_MAP.keywords
      ? (row[COLUMN_MAP.keywords] || "").split(",").map((k) => k.trim()).filter(Boolean)
      : [];
    const slug = displayName ? toSlug(displayName) : null;

    try {
      // 1. Get or create auth user
      let userId;
      const { data: existing } = await admin.auth.admin.listUsers();
      const found = existing?.users.find((u) => u.email === email);

      if (found) {
        userId = found.id;
        console.log(`  EXISTS  ${email} (${userId.slice(0, 8)}…)`);
      } else {
        if (isDryRun) {
          console.log(`  CREATE  ${email} [dry run]`);
          stats.created++;
          continue;
        }
        const { data, error } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { displayName },
        });
        if (error) throw new Error(`createUser failed: ${error.message}`);
        userId = data.user.id;
        console.log(`  CREATE  ${email} (${userId.slice(0, 8)}…)`);
        stats.created++;
      }

      // 2. Upsert profile row
      if (!isDryRun) {
        await sql`
          INSERT INTO profiles (
            id, display_name, slug, bio, location, live_desire,
            emergency_contact, supplementary_info, keywords, avatar_url
          ) VALUES (
            ${userId}::uuid,
            ${displayName},
            ${slug},
            ${bio},
            ${location},
            ${liveDesire},
            ${emergencyContact},
            ${supplementaryInfo},
            ${keywords}::text[],
            ${avatarUrl}
          )
          ON CONFLICT (id) DO UPDATE SET
            display_name    = EXCLUDED.display_name,
            slug            = EXCLUDED.slug,
            bio             = EXCLUDED.bio,
            location        = EXCLUDED.location,
            live_desire     = EXCLUDED.live_desire,
            emergency_contact = EXCLUDED.emergency_contact,
            supplementary_info = EXCLUDED.supplementary_info,
            keywords        = EXCLUDED.keywords,
            avatar_url      = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url)
        `;
        if (found) stats.updated++;
      } else {
        console.log(`  UPSERT  profile for ${email} [dry run]`);
        if (found) stats.updated++;
      }
    } catch (err) {
      console.error(`  ERROR   ${email}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`
Done.
  Created:  ${stats.created}
  Updated:  ${stats.updated}
  Skipped:  ${stats.skipped}
  Errors:   ${stats.errors}
`);

  await sql.end();
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
