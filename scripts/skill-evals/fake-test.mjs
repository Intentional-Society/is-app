#!/usr/bin/env node
// Fake `npm test` for skill-eval sandboxes. make-sandbox copies this into each sandbox's
// repo as `.skill-eval-fake-test.mjs`, and the sandbox package.json's "test" script runs it.
// Passes instantly. Red-path (spec II.2b): if a `.skill-eval-fail-test` sentinel file exists
// in the working dir, exit non-zero — lets a red-control eval force a failing gate cheaply.
import fs from "node:fs";

if (fs.existsSync(".skill-eval-fail-test")) {
  process.stderr.write("skill-eval fake npm test: FAIL (red-path sentinel .skill-eval-fail-test present)\n");
  process.exit(1);
}
process.stdout.write("skill-eval fake npm test: all suites passed (sandbox stub)\n");
process.exit(0);
