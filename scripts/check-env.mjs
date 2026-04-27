#!/usr/bin/env node
// Preflight: verify .env.local contains every key declared in .env.local.example.
// Runs as the first step of `npm run dev:db` so missing keys surface at the
// dev/test boundary with an actionable error, instead of leaking through to
// test failures ten layers deep. Keys-only — values are not compared, since
// devs are free to override locally.
//
// Pass --fix to append any missing key lines from .env.local.example to
// .env.local. Non-destructive: existing values are untouched.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixMode = process.argv.slice(2).includes("--fix");

const repoRoot = resolve(import.meta.dirname, "..");
const examplePath = resolve(repoRoot, ".env.local.example");
const localPath = resolve(repoRoot, ".env.local");

const KEY_LINE = /^([A-Z][A-Z0-9_]*)=/;

function extractKeys(contents) {
  const keys = new Set();
  for (const line of contents.split(/\r?\n/)) {
    const m = line.match(KEY_LINE);
    if (m) keys.add(m[1]);
  }
  return keys;
}

if (!existsSync(examplePath)) {
  console.error("check-env: .env.local.example is missing from the repo.");
  console.error(
    "  This file is the canonical list of env keys and should be committed.",
  );
  process.exit(1);
}

if (!existsSync(localPath)) {
  console.error("check-env: .env.local is missing.");
  console.error("  Fix: run `npm run setup`.");
  process.exit(1);
}

const exampleContents = readFileSync(examplePath, "utf8");
const localContents = readFileSync(localPath, "utf8");
const exampleKeys = extractKeys(exampleContents);
const localKeys = extractKeys(localContents);

const missing = [...exampleKeys].filter((k) => !localKeys.has(k));
if (missing.length > 0) {
  if (fixMode) {
    const missingSet = new Set(missing);
    const linesToAppend = exampleContents.split(/\r?\n/).filter((line) => {
      const m = line.match(KEY_LINE);
      return m && missingSet.has(m[1]);
    });
    const needsLeadingNewline =
      localContents.length > 0 && !localContents.endsWith("\n");
    const today = new Date().toISOString().slice(0, 10);
    const block =
      (needsLeadingNewline ? "\n" : "") +
      `# Appended by \`scripts/check-env.mjs --fix\` on ${today}\n` +
      linesToAppend.join("\n") +
      "\n";
    appendFileSync(localPath, block);
    process.stdout.write(
      `check-env --fix: appended ${missing.length} key(s) to .env.local:\n`,
    );
    for (const key of missing) process.stdout.write(`  + ${key}\n`);
    process.exit(0);
  }

  console.error(
    `check-env: .env.local is missing ${missing.length} key(s) declared in .env.local.example:`,
  );
  for (const key of missing) console.error(`  - ${key}`);
  console.error(
    "  Fix: run `node scripts/check-env.mjs --fix` to append the missing keys",
  );
  console.error(
    "       (preserves any custom values you've added).",
  );
  console.error(
    "       Or (destructive, wipes local customizations): delete .env.local",
  );
  console.error(
    "       and run `npm run setup` to regenerate from the template.",
  );
  process.exit(1);
}

process.stdout.write(`check-env: ok (${exampleKeys.size} keys)\n`);
