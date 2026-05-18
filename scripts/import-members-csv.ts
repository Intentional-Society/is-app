/**
 * Import IS member data from a CSV export of the Google Sheet signup form.
 *
 * One-off importer for issue #141: loads the existing signup backlog
 * (profiles + Google Drive photos + program signups) into is-app.
 * Safe to re-run — a second run only does work for genuinely new rows,
 * so the 1-2 signups that land in the form-to-app switchover gap can
 * be picked up later without disturbing anyone already imported.
 *
 * USAGE
 *   npx tsx scripts/import-members-csv.ts "<path-to-csv>" [--dry-run] [--prod]
 *
 *   --dry-run  Parse the CSV, fetch + re-encode every photo, and
 *              report what would be written. Touches no database and
 *              uploads nothing. Run this first.
 *   --prod     Load .env.prod and target production. Without it the
 *              script loads .env.local and refuses to run if the
 *              Supabase URL does not look local.
 *
 * RECOMMENDED WORKFLOW
 *   1. --dry-run against local — shape-checks the CSV and every photo.
 *   2. Real run against local Supabase, inspect in Studio, then
 *      `npm run dev:db:reset` to wipe it. Disposable rehearsal.
 *   3. Create a temporary .env.prod (gitignored via .env.*) holding the
 *      production NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, and the
 *      pooler DATABASE_URL — copy them from the Supabase dashboard.
 *   4. Real run with --prod. Delete .env.prod afterwards.
 *
 * ENV VARS (read from .env.local, or .env.prod with --prod)
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 *   DATABASE_URL
 *
 * PHOTO CACHE
 *   Downloaded photos are cached under scripts/.import-cache/, keyed by
 *   Drive file ID. Re-runs read the cache and skip the network. The
 *   cache is also the override point: drop a file named exactly
 *   <fileId> there and the run uses it instead of the Drive original
 *   — used to swap HEIC photos (which sharp cannot decode) for
 *   hand-converted JPEGs. A photo that still fails is reported and
 *   skipped; the member imports without an avatar.
 *
 * EMAIL SAFETY
 *   Auth users are created with the Admin API (`createUser`), which
 *   sends no email. Nothing else here sends mail either — the import
 *   is silent. Members are sign-in-able immediately (no password; they
 *   sign in via magic link once you onboard them).
 *
 * PROGRAMS — PREFLIGHT, NEVER CREATED
 *   This script never creates programs. It links members to programs
 *   that must already exist — the ones they checked on the form
 *   (PROGRAM_SLUG_BY_LABEL) plus the auto-subscribe programs everyone
 *   gets (AUTO_SUBSCRIBE_SLUGS). A preflight check aborts before any
 *   write if a required slug is missing — create those programs first.
 *
 * IDEMPOTENCY
 *   - Auth users: looked up by email, created only if absent.
 *   - Profiles: INSERT ... ON CONFLICT (id) DO NOTHING — a re-run never
 *     overwrites edits a member has since made in the app.
 *   - Photos: imported only when the profile has no avatar yet, so a
 *     re-run does not re-download or orphan files.
 *   - Program links: written only for profiles inserted by this run, so
 *     a re-run does not re-add a program a member removed in-app.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { config } from "dotenv";
import { eq, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// CSV column headers — the exact strings from the IS signup sheet export.
// ---------------------------------------------------------------------------
const COLUMN = {
  email: "Email address",
  name: "Name",
  bio: "Who are you?",
  keywords: "Keywords",
  location: "Approximate Location",
  supplementaryInfo: "Supplementary info",
  referredByLegacy: "I am being referred by",
  programs: "Which IS relational programs do you want to sign up for?",
  photo: "Profile Picture",
  emergencyContact: "Emergency Contact(s)",
  liveDesire: "Live desire",
} as const;

// CSV checkbox label -> programs.slug. The script links to programs with
// these slugs; it does not create them (see header). Update both sides
// if the form's program options change.
const PROGRAM_SLUG_BY_LABEL: Record<string, string> = {
  "Community Calls (weekly)": "community-calls",
  "Curated 1-on-1 Introductions (monthly)": "curated-introductions",
  "Q2 Presence Pods (4 calls)": "presence-pods-2026-q2",
  "Q3 Casework Pods (4 calls)": "casework-pods-2026-q3",
  "Arts in IS (monthly)": "arts-in-is",
};

// Programs every imported member is linked to regardless of what they
// checked on the form — the weekly newsletter is an auto-subscription,
// not a signup checkbox. Like the labelled programs, these must already
// exist; the preflight checks them too.
const AUTO_SUBSCRIBE_SLUGS = ["weekly-web-updates"];

// ---------------------------------------------------------------------------
// CSV parsing — a state machine that correctly handles commas, escaped
// quotes (""), and newlines inside quoted cells. Google Forms free-text
// answers routinely contain newlines, so a line-by-line parser corrupts
// them; this reads the whole file and tracks quote state across lines.
// ---------------------------------------------------------------------------
function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const dataRows = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (dataRows.length === 0) return [];
  const headers = dataRows[0].map((h) => h.trim());
  return dataRows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? "").trim();
    });
    return obj;
  });
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Returns a slug not present in `used`, adding the chosen slug to it.
// Collisions get a numeric suffix (-2, -3, ...) because profiles.slug
// is UNIQUE — two members named the same would otherwise fail to insert.
function uniqueSlug(base: string, used: Set<string>): string {
  const root = base || "member";
  if (!used.has(root)) {
    used.add(root);
    return root;
  }
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

// Google Forms file-upload links look like https://drive.google.com/open?id=ID.
// The download endpoint wants the bare ID. /file/d/ID/ is handled too,
// just in case the sheet ever holds that form.
function driveFileId(url: string): string | null {
  try {
    const id = new URL(url).searchParams.get("id");
    if (id) return id;
  } catch {
    // not a URL — fall through
  }
  const match = url.match(/\/file\/d\/([-\w]+)/);
  return match ? match[1] : null;
}

// On-disk cache of photo bytes, keyed by Drive file ID. A re-run reads
// from here and skips the network entirely. It is also the override
// point: drop a file named exactly <fileId> here and the run uses it
// instead of the Drive original — how the HEIC photos sharp cannot
// decode get swapped for hand-converted JPEGs.
const PHOTO_CACHE_DIR = resolve(process.cwd(), "scripts/.import-cache");

// Returns photo bytes for a Drive URL: from the cache if present,
// otherwise downloaded and then written to the cache. The encoder
// (sharp) is the format validator — this only guards against caching
// Drive's HTML interstitial as if it were a file.
async function getPhoto(url: string): Promise<Buffer> {
  const id = driveFileId(url);
  if (!id) throw new Error(`unrecognised Drive URL: ${url}`);
  const cachePath = resolve(PHOTO_CACHE_DIR, id);

  if (existsSync(cachePath)) {
    return readFileSync(cachePath);
  }

  const res = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  if ((res.headers.get("content-type") ?? "").startsWith("text/html")) {
    // Drive serves an HTML page (file too large / access-restricted)
    // instead of the bytes — don't cache a web page as a photo.
    throw new Error("Drive returned an HTML page, not a file");
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  mkdirSync(PHOTO_CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, bytes);
  return bytes;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isProd = args.includes("--prod");
  const csvPath = args.find((a) => !a.startsWith("--"));

  if (!csvPath) {
    console.error('Usage: npx tsx scripts/import-members-csv.ts "<path-to-csv>" [--dry-run] [--prod]');
    process.exit(1);
  }

  // Env file: .env.prod for production, .env.local otherwise.
  const envFile = isProd ? ".env.prod" : ".env.local";
  config({ path: resolve(process.cwd(), envFile), quiet: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!supabaseUrl || !secretKey || !dbUrl) {
    console.error(
      `Missing env vars in ${envFile}: ` +
        "NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, DATABASE_URL must all be set.",
    );
    process.exit(1);
  }

  // ---- Prod guard --------------------------------------------------------
  const host = (() => {
    try {
      return new URL(supabaseUrl).host;
    } catch {
      return supabaseUrl;
    }
  })();
  const looksLocal = host.includes("127.0.0.1") || host.includes("localhost");

  if (isProd && looksLocal) {
    console.error(`Refusing to run: --prod was passed but ${envFile} points at a local URL (${host}).`);
    process.exit(1);
  }
  if (!isProd && !looksLocal) {
    console.error(
      `Refusing to run: ${envFile} points at a non-local URL (${host}).\n` +
        "Pass --prod (which loads .env.prod) to target production deliberately.",
    );
    process.exit(1);
  }

  const fingerprint = `${secretKey.slice(0, 8)}...${secretKey.slice(-4)}`;
  console.log(`\nTarget:  ${host}`);
  console.log(`Key:     ${fingerprint}`);
  console.log(`Mode:    ${isDryRun ? "DRY RUN — nothing will be written" : "LIVE — writes enabled"}\n`);

  if (isProd && !isDryRun) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`This writes to PRODUCTION. Type the target host (${host}) to proceed: `);
    rl.close();
    if (answer.trim() !== host) {
      console.error("Confirmation did not match. Aborting.");
      process.exit(1);
    }
    console.log();
  }

  // ---- App modules — imported after dotenv so they read the right env ----
  const { db } = await import("@/server/db.js");
  const { profiles, programs, profilePrograms } = await import("@/server/schema.js");
  const { encodeAvatar, replaceAvatar } = await import("@/server/avatars.js");
  const { supabaseAdmin } = await import("@/lib/supabase/admin.js");

  // ---- Parse CSV ---------------------------------------------------------
  const rows = parseCSV(readFileSync(resolve(csvPath), "utf8"));
  console.log(`Parsed ${rows.length} rows from ${csvPath}.`);

  // ---- Program preflight — abort before any write if a slug is missing --
  const requiredSlugs = [...new Set([...Object.values(PROGRAM_SLUG_BY_LABEL), ...AUTO_SUBSCRIBE_SLUGS])];
  const existingPrograms = await db
    .select({ id: programs.id, slug: programs.slug })
    .from(programs)
    .where(inArray(programs.slug, requiredSlugs));
  const programIdBySlug = new Map(existingPrograms.map((p) => [p.slug, p.id]));
  const missingSlugs = requiredSlugs.filter((s) => !programIdBySlug.has(s));
  if (missingSlugs.length > 0) {
    console.error(
      `\nMissing programs — create these (with these exact slugs) before importing:\n` +
        missingSlugs.map((s) => `  - ${s}`).join("\n"),
    );
    process.exit(1);
  }
  console.log(`Program preflight OK — all ${requiredSlugs.length} programs exist.`);

  // ---- Preload existing auth users (one paginated sweep) -----------------
  const userIdByEmail = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    for (const u of data.users) {
      if (u.email) userIdByEmail.set(u.email.toLowerCase(), u.id);
    }
    if (data.users.length < 1000) break;
  }

  // ---- Preload existing profile slugs so new slugs stay unique -----------
  const usedSlugs = new Set<string>();
  for (const p of await db.select({ slug: profiles.slug }).from(profiles)) {
    if (p.slug) usedSlugs.add(p.slug);
  }

  const stats = {
    usersCreated: 0,
    usersExisting: 0,
    profilesInserted: 0,
    profilesSkipped: 0,
    photosImported: 0,
    photosSkipped: 0,
    photoErrors: 0,
    programLinks: 0,
    errors: 0,
  };

  // ---- Process rows ------------------------------------------------------
  for (const row of rows) {
    const email = (row[COLUMN.email] ?? "").toLowerCase().trim();
    if (!email) {
      console.warn(`  SKIP   — row has no email`);
      stats.errors++;
      continue;
    }

    try {
      const name = row[COLUMN.name] ?? "";
      const slug = uniqueSlug(toSlug(name), usedSlugs);
      const keywords = (row[COLUMN.keywords] ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

      // 1. Auth user — look up, create only if absent.
      let userId = userIdByEmail.get(email);
      const userExisted = userId !== undefined;
      if (userExisted) {
        stats.usersExisting++;
      } else if (isDryRun) {
        console.log(`  CREATE ${email}  [dry run]`);
        stats.usersCreated++;
      } else {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { displayName: name || null },
        });
        if (error) throw new Error(`createUser failed: ${error.message}`);
        userId = data.user.id;
        userIdByEmail.set(email, userId);
        console.log(`  CREATE ${email}  (${userId.slice(0, 8)}...)`);
        stats.usersCreated++;
      }

      // 2. Profile row — INSERT ... ON CONFLICT (id) DO NOTHING.
      let profileInserted = false;
      let currentAvatarPath: string | null = null;
      if (isDryRun) {
        profileInserted = !userExisted;
        if (profileInserted) stats.profilesInserted++;
        else stats.profilesSkipped++;
        console.log(`  ${userExisted ? "PROFILE skip (exists)" : "PROFILE insert"}  ${email} -> slug "${slug}"`);
      } else {
        const inserted = await db
          .insert(profiles)
          .values({
            id: userId!,
            displayName: name || null,
            slug,
            bio: row[COLUMN.bio] || null,
            keywords,
            location: row[COLUMN.location] || null,
            supplementaryInfo: row[COLUMN.supplementaryInfo] || null,
            referredByLegacy: row[COLUMN.referredByLegacy] || null,
            emergencyContact: row[COLUMN.emergencyContact] || null,
            liveDesire: row[COLUMN.liveDesire] || null,
          })
          .onConflictDoNothing({ target: profiles.id })
          .returning({ id: profiles.id });
        profileInserted = inserted.length > 0;
        if (profileInserted) {
          stats.profilesInserted++;
        } else {
          stats.profilesSkipped++;
          const [existing] = await db
            .select({ avatarPath: profiles.avatarPath })
            .from(profiles)
            .where(eq(profiles.id, userId!));
          currentAvatarPath = existing?.avatarPath ?? null;
        }
      }

      // 3. Photo — import only when the profile has no avatar yet. A
      //    photo failure is isolated in its own try/catch: the member
      //    still imports without an avatar rather than the whole row
      //    aborting, and can be fixed later via the cache override.
      const photoUrl = row[COLUMN.photo] ?? "";
      if (!photoUrl) {
        // No photo on the form row — nothing to import.
      } else if (!isDryRun && currentAvatarPath) {
        stats.photosSkipped++;
      } else {
        try {
          const original = await getPhoto(photoUrl);
          const webp = await encodeAvatar(original);
          if (isDryRun) {
            console.log(
              `  PHOTO  ${email}  ${(original.length / 1024).toFixed(0)}KB -> ${(webp.length / 1024).toFixed(0)}KB WebP  [dry run]`,
            );
          } else {
            await replaceAvatar(userId!, webp);
          }
          stats.photosImported++;
        } catch (err) {
          console.error(`  PHOTO FAIL  ${email}: ${err instanceof Error ? err.message : String(err)}`);
          console.error(`              override: place a JPEG/PNG at scripts/.import-cache/${driveFileId(photoUrl)}`);
          stats.photoErrors++;
        }
      }

      // 4. Program links — only for profiles inserted by this run, so a
      //    re-run does not re-add a program a member removed in-app.
      //    Each member is linked to the programs they checked on the
      //    form plus the auto-subscribe programs (the newsletter).
      if (profileInserted) {
        const slugs = new Set(AUTO_SUBSCRIBE_SLUGS);
        const labels = (row[COLUMN.programs] ?? "")
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        for (const label of labels) {
          const programSlug = PROGRAM_SLUG_BY_LABEL[label];
          if (programSlug) {
            slugs.add(programSlug);
          } else {
            console.warn(`  WARN   ${email}: unknown program "${label}" — not linked`);
          }
        }
        for (const programSlug of slugs) {
          const programId = programIdBySlug.get(programSlug)!;
          if (!isDryRun) {
            await db.insert(profilePrograms).values({ profileId: userId!, programId }).onConflictDoNothing();
          }
          stats.programLinks++;
        }
      }
    } catch (err) {
      console.error(`  ERROR  ${email}: ${err instanceof Error ? err.message : String(err)}`);
      stats.errors++;
    }
  }

  console.log(`
Done${isDryRun ? " (dry run — nothing was written)" : ""}.
  Users created:      ${stats.usersCreated}
  Users existing:     ${stats.usersExisting}
  Profiles inserted:  ${stats.profilesInserted}
  Profiles skipped:   ${stats.profilesSkipped}
  Photos imported:    ${stats.photosImported}
  Photos skipped:     ${stats.photosSkipped}
  Photo failures:     ${stats.photoErrors}
  Program links:      ${stats.programLinks}
  Errors:             ${stats.errors}
`);

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
