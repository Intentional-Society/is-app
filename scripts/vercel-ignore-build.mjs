#!/usr/bin/env node
// Vercel's Ignored Build Step (vercel.json `ignoreCommand`). Exit 0 skips the
// build; exit 1 builds. Skips docs-only changes as scripts/docs-only.mjs
// defines them. See docs/strategy-committing.md → "Skipping deploys for
// docs-only changes".
//
// Runs before `npm install`, so it and docs-only.mjs use Node built-ins only.
// It lives in a file because Vercel caps `ignoreCommand` at 256 characters.

import { execFileSync } from "node:child_process";

import { isDocsOnly } from "./docs-only.mjs";

const env = process.env;

// main compares against the last successful production deploy; other
// branches compare against main's tip, because VERCEL_GIT_PREVIOUS_SHA is
// empty on a branch's first push.
const base = env.VERCEL_GIT_COMMIT_REF === "main" ? env.VERCEL_GIT_PREVIOUS_SHA : "main";

// Same-commit dashboard Redeploy (e.g. to pick up a changed env var) builds.
if (!base || base === env.VERCEL_GIT_COMMIT_SHA) process.exit(1);

try {
  // Vercel's clone has no `origin` remote, so fetch by URL into FETCH_HEAD.
  // Fetch errors stay on stderr so they show in the Vercel build log.
  execFileSync(
    "git",
    ["fetch", "--depth=1", `https://github.com/${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}.git`, base],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (!isDocsOnly(["FETCH_HEAD", "HEAD"])) process.exit(1);
} catch {
  // Any failure: build.
  process.exit(1);
}
process.exit(0);
