#!/usr/bin/env node
// Pushes auth email templates from supabase/templates/ to the hosted
// Supabase project via the Management API. Repo files are the source
// of truth — re-run this script after editing any template or its
// subject in supabase/templates/templates.manifest.mjs.
//
// Local dev does not need this script: supabase/config.toml wires the
// same files into the local stack, and `supabase start` reads them on
// startup (a stack restart is required after edits — see config.toml).
//
// Usage:
//   node scripts/update-email-templates.mjs --dry-run    # print what would be sent
//   node scripts/update-email-templates.mjs --download   # snapshot the current hosted templates to supabase/templates/_backup/<timestamp>/
//   node scripts/update-email-templates.mjs              # PATCH the hosted project
//
// Recommended first-time workflow: --download once (so you have the
// pre-customization content), then run without flags to push.
//
// Requires SUPABASE_ACCESS_TOKEN for the real push and for --download.
// Generate one at https://supabase.com/dashboard/account/tokens. This
// is an operator secret — never set it as a Vercel env var or commit it.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TEMPLATES } from "../supabase/templates/templates.manifest.mjs";

// From docs/doc-supabase.md → Production (hosted).
const PROJECT_REF = "oyuzjowguujwhqyhijzx";
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const download = args.has("--download");

if (dryRun && download) {
  console.error("--dry-run and --download are mutually exclusive (--dry-run previews a push, --download saves the current remote state).");
  process.exit(1);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token && !dryRun) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN. Create a personal access token at\n" +
      "  https://supabase.com/dashboard/account/tokens\n" +
      "and export it before re-running (or pass --dry-run to skip the network call).",
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(here, "..", "supabase", "templates");

// Every GoTrue template type — covers more than what TEMPLATES knows
// about because --download is also a safety net before mutating
// anything, so it grabs whatever else lives in the dashboard.
const ALL_TYPES = ["invite", "confirmation", "recovery", "magic_link", "email_change", "reauthentication"];

if (download) {
  const res = await fetch(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`GET failed: ${res.status} ${res.statusText}`);
    console.error(await res.text());
    process.exit(1);
  }
  const config = await res.json();

  // Timestamp like 2026-05-20T17-12-26 — filesystem-safe and sortable.
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = join(templatesDir, "_backup", ts);
  await mkdir(backupDir, { recursive: true });

  const subjects = {};
  let contentCount = 0;
  for (const type of ALL_TYPES) {
    const subject = config[`mailer_subjects_${type}`];
    const content = config[`mailer_templates_${type}_content`];
    if (subject != null && subject !== "") subjects[type] = subject;
    if (content) {
      await writeFile(join(backupDir, `${type}.html`), content, "utf8");
      contentCount++;
    }
  }
  await writeFile(join(backupDir, "subjects.json"), `${JSON.stringify(subjects, null, 2)}\n`, "utf8");

  console.log(`Snapshotted hosted templates from project ${PROJECT_REF}:`);
  console.log(`  ${backupDir}`);
  console.log(`  ${contentCount} non-empty HTML files, ${Object.keys(subjects).length} subjects`);
  console.log("\nRe-run without --download to push the repo templates.");
  process.exit(0);
}

// Management API field naming follows GoTrue's config keys —
// `mailer_subjects_<type>` and `mailer_templates_<type>_content`.
// The Supabase template type names (magic_link, confirmation,
// recovery, …) are the same as in TEMPLATES.
const payload = {};
for (const [type, { subject, file }] of Object.entries(TEMPLATES)) {
  const html = await readFile(join(templatesDir, file), "utf8");
  payload[`mailer_subjects_${type}`] = subject;
  payload[`mailer_templates_${type}_content`] = html;
}

if (dryRun) {
  console.log(`DRY RUN — would PATCH ${API_URL} with:`);
  for (const key of Object.keys(payload).sort()) {
    const value = payload[key];
    if (key.endsWith("_content")) {
      console.log(`  ${key}: <${value.length} chars of HTML>`);
    } else {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    }
  }
  process.exit(0);
}

const res = await fetch(API_URL, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

if (!res.ok) {
  console.error(`PATCH failed: ${res.status} ${res.statusText}`);
  console.error(await res.text());
  process.exit(1);
}

const types = Object.keys(TEMPLATES).join(", ");
console.log(`Updated ${Object.keys(TEMPLATES).length} email templates (${types}) on project ${PROJECT_REF}.`);
