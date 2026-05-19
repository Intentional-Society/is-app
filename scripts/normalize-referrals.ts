/**
 * Referral normalization helper for the #141 member import.
 *
 * The CSV importer parks the Google Form's free-text "I am being
 * referred by" answers in profiles.referred_by_legacy and leaves the
 * structured profiles.referred_by (a uuid FK to the referrer's
 * profile) null. Turning that text into real referred_by links can
 * only happen AFTER the import — the referrers are themselves imported
 * members and only get UUIDs once their rows exist.
 *
 * Two modes:
 *   Generate (default) — reads every profile that still has
 *     referred_by_legacy set and referred_by null, matches the free
 *     text against all members by name, and writes an annotated SQL
 *     file: an exact single-name match becomes a ready-to-run UPDATE,
 *     everything else is a comment for you to resolve by hand. This
 *     mode only READS the database.
 *   Apply (--apply <file>) — runs a reviewed SQL file back against the
 *     database. Every statement must be a referred_by UPDATE or the
 *     run aborts, so the wrong file cannot be executed by mistake.
 *
 * USAGE
 *   Generate a reviewable SQL file:
 *     npx tsx scripts/normalize-referrals.ts [--prod]
 *   Apply a reviewed SQL file:
 *     npx tsx scripts/normalize-referrals.ts --apply <file.sql> [--prod]
 *
 *   --prod    Load .env.prod and target production. Without it the
 *             script loads .env.local and refuses a non-local URL.
 *   --apply   Execute a reviewed referral-update SQL file. Targeting
 *             production requires a typed confirmation.
 *
 * ENV VARS (from .env.local, or .env.prod with --prod)
 *   NEXT_PUBLIC_SUPABASE_URL
 *   DATABASE_URL
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { config } from "dotenv";
import postgres from "postgres";

const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
// Split on any run of non-alphanumerics, so punctuation in the
// free-text answer ("Jochen :)", "Myself.") does not defeat matching.
const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

// True when every token of the shorter name appears in the longer —
// matches "Jenny" against "Jenny Stefanotti" without matching on a
// stray short word that happens to appear in someone's name.
function tokenSubset(a: string[], b: string[]): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length === 0) return false;
  return short.every((t) => long.includes(t));
}

type Profile = { id: string; displayName: string | null; referredBy: string | null; referredByLegacy: string | null };

// Exact shape of a statement the generator emits and --apply accepts:
// UPDATE profiles SET referred_by = '<uuid>' WHERE id = '<uuid>'.
// Anything else is rejected, so a stray file cannot be run by mistake
// and a mass UPDATE (no WHERE) cannot slip through.
const REFERRAL_UPDATE = /^update\s+profiles\s+set\s+referred_by\s*=\s*'[0-9a-f-]+'\s+where\s+id\s*=\s*'[0-9a-f-]+'$/i;

// Applies a reviewed referral-update SQL file. Comments are stripped,
// every remaining statement is checked against REFERRAL_UPDATE, then
// each runs as its own autocommit UPDATE — no multi-statement
// transaction, which the Supabase pooler can mishandle (see
// docs/strategy-db-transactions.md).
async function applyReferralUpdates(filePath: string, isProd: boolean, host: string): Promise<void> {
  const absPath = resolve(filePath);
  const stripped = readFileSync(absPath, "utf8")
    .split(/\r?\n/)
    .map((line) => {
      const comment = line.indexOf("--");
      return comment >= 0 ? line.slice(0, comment) : line;
    })
    .join("\n");
  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  if (statements.length === 0) {
    console.log(`\n${absPath}\n  Nothing to apply — no uncommented statements.\n`);
    return;
  }
  const bad = statements.find((s) => !REFERRAL_UPDATE.test(s));
  if (bad) {
    console.error(`\nRefusing to apply ${absPath} —`);
    console.error(`  not a referred_by UPDATE:\n    ${bad}\n`);
    process.exit(1);
  }

  console.log(`\nApply:   ${absPath}`);
  console.log(`Target:  ${host}`);
  console.log(`${statements.length} referral UPDATE statement(s).\n`);

  if (isProd) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`This writes to PRODUCTION. Type the target host (${host}) to proceed: `);
    rl.close();
    if (answer.trim() !== host) {
      console.error("Confirmation did not match. Aborting.");
      process.exit(1);
    }
  }

  const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
  let rowsUpdated = 0;
  try {
    for (const statement of statements) {
      const result = await sql.unsafe(statement);
      rowsUpdated += result.count ?? 0;
    }
  } finally {
    await sql.end();
  }
  console.log(`\nDone — ${rowsUpdated} row(s) updated.\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const isProd = args.includes("--prod");
  const applyIdx = args.indexOf("--apply");
  const applyFile = applyIdx >= 0 ? args[applyIdx + 1] : undefined;
  if (applyIdx >= 0 && (applyFile === undefined || applyFile.startsWith("--"))) {
    console.error("--apply needs a file path: --apply <path-to-reviewed.sql>");
    process.exit(1);
  }

  const envFile = isProd ? ".env.prod" : ".env.local";
  config({ path: resolve(process.cwd(), envFile), quiet: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl || !process.env.DATABASE_URL) {
    console.error(`Missing env vars in ${envFile}: NEXT_PUBLIC_SUPABASE_URL and DATABASE_URL must be set.`);
    process.exit(1);
  }

  // Local/prod sanity check — the script must not silently target the
  // wrong database. Generate mode only reads; --apply additionally
  // takes a typed confirmation before writing to production.
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
    console.error(`Refusing to run: ${envFile} points at a non-local URL (${host}). Pass --prod to target production.`);
    process.exit(1);
  }

  if (applyFile) {
    await applyReferralUpdates(applyFile, isProd, host);
    process.exit(0);
  }

  console.log(`\nReading profiles from: ${host}\n`);

  // App modules imported after dotenv so they read the right env.
  const { db } = await import("@/server/db.js");
  const { profiles } = await import("@/server/schema.js");

  const all: Profile[] = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      referredBy: profiles.referredBy,
      referredByLegacy: profiles.referredByLegacy,
    })
    .from(profiles);

  // Profiles still needing a link: legacy text present, referred_by
  // not yet set (so a re-run skips ones already resolved by hand).
  const pending = all.filter((p) => p.referredByLegacy && !p.referredBy);

  const confident: { target: Profile; referrer: Profile }[] = [];
  const review: { target: Profile; note: string; candidates: Profile[] }[] = [];

  for (const target of pending) {
    const legacy = normalize(target.referredByLegacy ?? "");
    const named = all.filter((m) => m.displayName);

    const exact = named.filter((m) => normalize(m.displayName ?? "") === legacy);
    const exactOthers = exact.filter((m) => m.id !== target.id);

    if (exactOthers.length === 1) {
      confident.push({ target, referrer: exactOthers[0] });
    } else if (exactOthers.length > 1) {
      review.push({ target, note: "ambiguous — exact name matches several members", candidates: exactOthers });
    } else if (exact.length > 0) {
      review.push({ target, note: "names themselves — likely self, leave referred_by null", candidates: [] });
    } else {
      const fuzzy = named.filter(
        (m) => m.id !== target.id && tokenSubset(tokenize(legacy), tokenize(m.displayName ?? "")),
      );
      if (fuzzy.length > 0) {
        review.push({ target, note: "partial name match — confirm the right person", candidates: fuzzy });
      } else {
        review.push({
          target,
          note: "no name match — likely self or free text, leave referred_by null",
          candidates: [],
        });
      }
    }
  }

  // ---- Console report ----------------------------------------------------
  const nameOf = (p: Profile) => p.displayName ?? "(no name)";
  console.log(`${pending.length} profile(s) have referred_by_legacy to resolve.\n`);

  if (confident.length > 0) {
    console.log(`CONFIDENT — ${confident.length} (become UPDATE statements):`);
    for (const { target, referrer } of confident) {
      console.log(`  ${nameOf(target)}  <-- "${target.referredByLegacy}"  =>  ${nameOf(referrer)}`);
    }
    console.log();
  }
  if (review.length > 0) {
    console.log(`REVIEW — ${review.length} (commented in the SQL file for you to resolve):`);
    for (const { target, note, candidates } of review) {
      console.log(`  ${nameOf(target)}  <-- "${target.referredByLegacy}"  — ${note}`);
      for (const c of candidates) console.log(`      candidate: ${nameOf(c)}  ${c.id}`);
    }
    console.log();
  }

  // ---- SQL file ----------------------------------------------------------
  const outDir = resolve(process.cwd(), "scripts/.import-logs");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `referral-updates-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);

  const lines: string[] = [
    `-- Referral normalization — generated ${new Date().toISOString()} against ${host}`,
    "-- Generated by scripts/normalize-referrals.ts. REVIEW before applying.",
    "--",
    "-- Confident matches (exact name) are ready-to-run UPDATEs below. Everything",
    '-- under "Needs review" is commented out — fill in a referrer id and',
    "-- uncomment, or leave it (self / free-text answers stay null).",
    "",
    "-- == Confident ==",
  ];
  if (confident.length === 0) lines.push("-- (none)");
  for (const { target, referrer } of confident) {
    lines.push(
      `UPDATE profiles SET referred_by = '${referrer.id}' WHERE id = '${target.id}';  -- ${nameOf(target)} <-- "${target.referredByLegacy}" => ${nameOf(referrer)}`,
    );
  }
  lines.push("", "-- == Needs review ==");
  if (review.length === 0) lines.push("-- (none)");
  for (const { target, note, candidates } of review) {
    lines.push(`-- ${nameOf(target)} (${target.id}) <-- "${target.referredByLegacy}"  — ${note}`);
    for (const c of candidates) {
      lines.push(
        `--   UPDATE profiles SET referred_by = '${c.id}' WHERE id = '${target.id}';  -- candidate: ${nameOf(c)}`,
      );
    }
  }
  lines.push("");
  writeFileSync(outPath, lines.join("\n"));

  console.log(`SQL written to: ${outPath}`);
  console.log(
    `Review and edit it, then apply with:\n` +
      `  npx tsx scripts/normalize-referrals.ts --apply "${outPath}"${isProd ? " --prod" : ""}\n`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("\nFatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
