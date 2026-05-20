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
//   node scripts/update-email-templates.mjs --dry-run   # print what would be sent
//   node scripts/update-email-templates.mjs             # PATCH the hosted project
//
// Requires SUPABASE_ACCESS_TOKEN in the environment. Generate one at
// https://supabase.com/dashboard/account/tokens. This is an operator
// secret — never set it as a Vercel env var or commit it.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TEMPLATES } from "../supabase/templates/templates.manifest.mjs";

// From docs/doc-supabase.md → Production (hosted).
const PROJECT_REF = "oyuzjowguujwhqyhijzx";
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;

const dryRun = process.argv.includes("--dry-run");

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
