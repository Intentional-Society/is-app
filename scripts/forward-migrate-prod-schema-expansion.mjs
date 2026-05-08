// Triggers the forward-migrate-prod-schema-expansion workflow against
// the current branch. The workflow itself pauses for review-gate
// approval before any prod credentials are injected into the runner —
// see .github/workflows/forward-migrate-prod-schema-expansion.yml.

import { execSync } from "node:child_process";

const run = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", ...opts }).trim();

let branch;
try {
  branch = run("git rev-parse --abbrev-ref HEAD");
} catch {
  console.error("Failed to read git branch — are you inside a git repo?");
  process.exit(1);
}
if (!branch || branch === "HEAD") {
  console.error("Refusing to run from a detached HEAD — check out a branch first.");
  process.exit(1);
}

const dirty = run("git status --porcelain");
if (dirty) {
  console.error(
    "Refusing to run with uncommitted changes — commit or stash first.\n" +
      "The workflow runs against the remote branch state; local-only edits would be invisible.",
  );
  process.exit(1);
}

try {
  run(`git fetch origin ${branch} --quiet`);
} catch {
  console.error(`origin/${branch} not found — push the branch first so the workflow can check it out.`);
  process.exit(1);
}
const localSha = run("git rev-parse HEAD");
const remoteSha = run(`git rev-parse origin/${branch}`);
if (localSha !== remoteSha) {
  console.error(
    `Local ${branch} (${localSha.slice(0, 8)}) is out of sync with origin/${branch} (${remoteSha.slice(0, 8)}).\n` +
      "Push your latest commits before triggering the workflow.",
  );
  process.exit(1);
}

console.log(`Dispatching forward-migrate-prod-schema-expansion against ref=${branch}`);
try {
  execSync(`gh workflow run forward-migrate-prod-schema-expansion.yml -f ref=${branch}`, { stdio: "inherit" });
} catch {
  console.error("gh CLI failed. Is `gh` installed and authed? See docs/setup-dev-machine.md.");
  process.exit(1);
}

console.log(
  "\nApprove the run at:\n" +
    "  https://github.com/Intentional-Society/is-app/actions/workflows/forward-migrate-prod-schema-expansion.yml",
);
