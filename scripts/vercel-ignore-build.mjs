#!/usr/bin/env node
// Vercel's Ignored Build Step (vercel.json `ignoreCommand`). Exit 0 skips the
// build; exit 1 builds. Skips when the only changes are in docs/ or the root
// AGENTS.md and CLAUDE.md. See docs/strategy-committing.md → "Skipping deploys
// for docs-only changes".
//
// Runs before `npm install`, so it uses Node built-ins only. It lives in a
// file because Vercel caps `ignoreCommand` at 256 characters.

import { execFileSync } from "node:child_process";

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
  execFileSync("git", ["diff", "--quiet", "FETCH_HEAD", "HEAD", "--", ".", ":!docs/", ":!AGENTS.md", ":!CLAUDE.md"], {
    stdio: "inherit",
  });
} catch {
  // A non-docs difference (git diff exits 1) or any failure: build.
  process.exit(1);
}
process.exit(0);
