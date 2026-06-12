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
//   node scripts/update-email-templates.mjs --download   # snapshot the current hosted templates to supabase/templates/_remote-snapshot/
//   node scripts/update-email-templates.mjs              # PATCH the hosted project
//
// Recommended first-time workflow: --download once (so you have the
// pre-customization content), then run without flags to push.
//
// SUPABASE_ACCESS_TOKEN is read from .env.prod (gitignored via .env.*),
// the prod-targeting convention for operator scripts. Workflow:
//
//   1. Generate a token at https://supabase.com/dashboard/account/tokens.
//   2. Create .env.prod in the repo root with:
//        SUPABASE_ACCESS_TOKEN=<the token>
//   3. Run the script.
//   4. Delete .env.prod when done — the token grants account-wide
//      access, treat the file as temporary.
//
// See docs/doc-supabase.md → "Personal access token (Management API)"
// for blast radius and rotation.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

import { TEMPLATES } from "../supabase/templates/templates.manifest.mjs";

config({ path: resolve(process.cwd(), ".env.prod"), quiet: true });

// From docs/doc-supabase.md → Production (hosted).
const PROJECT_REF = "oyuzjowguujwhqyhijzx";
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const download = args.has("--download");

if (dryRun && download) {
  console.error(
    "--dry-run and --download are mutually exclusive (--dry-run previews a push, --download saves the current remote state).",
  );
  process.exit(1);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token && !dryRun) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN. Create .env.prod in the repo root with:\n" +
      "  SUPABASE_ACCESS_TOKEN=<your-token>\n" +
      "Generate the token at https://supabase.com/dashboard/account/tokens.\n" +
      ".env.prod is gitignored; delete it after the script run.\n" +
      "Pass --dry-run to skip the network call without a token.",
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

  // Single-slot, always overwritten. Git provides the time dimension
  // via commit history; the filesystem doesn't need to. Wipe and
  // recreate so types that aren't currently set on the hosted project
  // don't linger as stale files from a previous run.
  const snapshotDir = join(templatesDir, "_remote-snapshot");
  await rm(snapshotDir, { recursive: true, force: true });
  await mkdir(snapshotDir, { recursive: true });

  // CodeQL flags the writeFile calls below as "remote data → file
  // system" (js/http-to-file-access). The remote source is
  // api.supabase.com authenticated with our personal access token; the
  // destination paths are deterministic constants from ALL_TYPES.
  // Writing the auth config to disk is the literal purpose of
  // --download — snapshotting prod for diff review.
  const subjects = {};
  let contentCount = 0;
  for (const type of ALL_TYPES) {
    const subject = config[`mailer_subjects_${type}`];
    const content = config[`mailer_templates_${type}_content`];
    if (subject != null && subject !== "") subjects[type] = subject;
    if (content) {
      await writeFile(join(snapshotDir, `${type}.html`), content, "utf8"); // lgtm[js/http-to-file-access]
      contentCount++;
    }
  }
  await writeFile(join(snapshotDir, "subjects.json"), `${JSON.stringify(subjects, null, 2)}\n`, "utf8"); // lgtm[js/http-to-file-access]

  console.log(`Snapshotted hosted templates from project ${PROJECT_REF}:`);
  console.log(`  ${snapshotDir}`);
  console.log(`  ${contentCount} non-empty HTML files, ${Object.keys(subjects).length} subjects`);
  console.log("\nNext steps:");
  console.log("  git diff supabase/templates/_remote-snapshot   # see what's currently in prod");
  console.log("  npm run update_email_templates -- --dry-run    # preview the push payload");
  console.log("  npm run update_email_templates                 # push, after reviewing");
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

// CodeQL flags the body below as "file data → outbound network"
// (js/file-access-to-http). The file data is committed, code-reviewed
// template HTML; the destination is authenticated api.supabase.com.
// Sending repo templates to the hosted project is the literal purpose
// of the push.
const res = await fetch(API_URL, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload), // lgtm[js/file-access-to-http]
});

if (!res.ok) {
  console.error(`PATCH failed: ${res.status} ${res.statusText}`);
  console.error(await res.text());
  process.exit(1);
}

const types = Object.keys(TEMPLATES).join(", ");
console.log(`Updated ${Object.keys(TEMPLATES).length} email templates (${types}) on project ${PROJECT_REF}.`);
