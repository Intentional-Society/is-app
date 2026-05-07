// Triggers the forward-migrate-prod-schema-expansion workflow against
// the current branch. The workflow itself pauses for review-gate
// approval before any prod credentials are injected into the runner —
// see .github/workflows/forward-migrate-prod-schema-expansion.yml.

import { execSync } from "node:child_process";

const run = (cmd, opts = {}) =>
  execSync(cmd, { encoding: "utf8", ...opts }).trim();

let branch;
try {
  branch = run("git rev-parse --abbrev-ref HEAD");
} catch {
  console.error("Failed to read git branch — are you inside a git repo?");
  process.exit(1);
}
if (!branch || branch === "HEAD") {
  console.error(
    "Refusing to run from a detached HEAD — check out a branch first.",
  );
  process.exit(1);
}

console.log(
  `Dispatching forward-migrate-prod-schema-expansion against ref=${branch}`,
);
try {
  execSync(
    `gh workflow run forward-migrate-prod-schema-expansion.yml -f ref=${branch}`,
    { stdio: "inherit" },
  );
} catch {
  console.error(
    "gh CLI failed. Is `gh` installed and authed? See docs/setup-dev-machine.md.",
  );
  process.exit(1);
}

console.log(
  "\nApprove the run at:\n" +
    "  https://github.com/Intentional-Society/is-app/actions/workflows/forward-migrate-prod-schema-expansion.yml",
);
