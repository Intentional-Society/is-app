#!/usr/bin/env node
// Idempotently applies repo-level GitHub settings (a branch ruleset
// protecting main). Re-run after editing the rules below to push the
// changes to GitHub. Requires `gh auth login` with admin rights on
// the repo.
//
// Usage:
//   node scripts/update-main-branch-protection.mjs           # apply
//   node scripts/update-main-branch-protection.mjs --dry-run # print what would be sent

import { spawnSync } from "node:child_process";

const REPO = "Intentional-Society/is-app";
const RULESET_NAME = "main branch protection";
const dryRun = process.argv.includes("--dry-run");

// Branch ruleset for main. Maps to the GitHub REST API request body
// for POST /repos/{owner}/{repo}/rulesets (and PUT for updates).
// https://docs.github.com/en/rest/repos/rules
const ruleset = {
  name: RULESET_NAME,
  target: "branch",
  enforcement: "active",
  // Admins can override in emergencies (CI wedged, urgent revert, etc).
  // Worth tightening if the team grows.
  bypass_actors: [
    {
      actor_id: 5, // built-in "Repository Admin" role
      actor_type: "RepositoryRole",
      bypass_mode: "always",
    },
  ],
  conditions: {
    ref_name: {
      // ~DEFAULT_BRANCH tracks whatever the repo's default is, so this
      // doesn't break if main ever gets renamed.
      include: ["~DEFAULT_BRANCH"],
      exclude: [],
    },
  },
  rules: [
    // Block branch deletion and force-pushes on main.
    { type: "deletion" },
    { type: "non_fast_forward" },
    // Require a PR for every change. Zero approvals (solo dev) — the
    // point is to force CI to gate every merge into main, since direct
    // pushes bypass the pull_request workflow trigger entirely.
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    },
    // Require CI to pass before merge. E2E intentionally not listed:
    // it runs against the Vercel preview, which can flake on cold
    // start. Treat as advisory and check manually before merging.
    {
      type: "required_status_checks",
      parameters: {
        // strict=true would force every PR to be rebased on main
        // before merging — too much churn for a small project. CI
        // re-runs on every push so we'll catch breakage on main fast
        // anyway.
        strict_required_status_checks_policy: false,
        required_status_checks: [{ context: "Lint & Functional Tests" }],
      },
    },
  ],
};

const body = JSON.stringify(ruleset, null, 2);

if (dryRun) {
  console.log(`Would upsert ruleset "${RULESET_NAME}" on ${REPO}:`);
  console.log(body);
  process.exit(0);
}

function gh(args, opts = {}) {
  const hasInput = typeof opts.input === "string";
  const result = spawnSync("gh", args, {
    input: hasInput ? opts.input : undefined,
    stdio: [hasInput ? "pipe" : "inherit", "pipe", "inherit"],
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const list = JSON.parse(gh(["api", `/repos/${REPO}/rulesets`]));
const existing = list.find((r) => r.name === RULESET_NAME);

if (existing) {
  console.log(`Updating ruleset #${existing.id} ("${RULESET_NAME}")...`);
  gh(
    [
      "api",
      "--method",
      "PUT",
      `/repos/${REPO}/rulesets/${existing.id}`,
      "--input",
      "-",
    ],
    { input: body },
  );
} else {
  console.log(`Creating new ruleset "${RULESET_NAME}"...`);
  gh(
    ["api", "--method", "POST", `/repos/${REPO}/rulesets`, "--input", "-"],
    { input: body },
  );
}

console.log(`\nRuleset "${RULESET_NAME}" applied to ${REPO}.`);
