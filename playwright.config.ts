import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load .env.local so the e2e session helper + reset-endpoint client
// can pick up the seeded user passwords and the CI reset token.
// Harmless in CI where the vars come from the environment instead.
loadEnv({ path: ".env.local", quiet: true });

const isCI = !!process.env.CI;
// Target the local dev server's port so `reuseExistingServer` finds a running
// `npm run dev` and runs against it, rather than starting a second `next dev`
// (two can't coexist in one worktree — they'd share one `.next`). A lane writes
// LANE_DEV_PORT into its .env.local; the base worktree has neither var and falls
// back to 3000, matching plain `npm run dev`. E2E_PORT stays as an explicit
// override. See docs/strategy-worktree-lanes.md.
const e2ePort = process.env.LANE_DEV_PORT || process.env.E2E_PORT || "3000";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // Serialized across files: welcome and invites both mutate the shared
  // seeded regular user's profile, so two spec files running in parallel
  // workers would race on each other's resets. Within-file parallelism
  // is also disabled by test.describe.configure({ mode: "serial" }) in
  // the affected specs.
  workers: 1,
  reporter: "html",
  expect: {
    // Wide polling window absorbs Next.js Fast Refresh / first-compile cost
    // without costing anything on the happy path — toBeVisible resolves as
    // soon as the element appears.
    timeout: 15000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    // Per-request timing for the redirect chain — see src/lib/timing.ts.
    // The middleware short-circuits unless this header is present, so the
    // cost on test traffic is a single header.get + boolean check; the
    // upside is continuous per-step timing data in Vercel function logs
    // for every CI run, queryable via `vercel logs ... --query "timing"`.
    extraHTTPHeaders: { "x-debug-timing": "1" },
  },
  // The setup project calls POST /api/_test/reset once at the top of the
  // run. Specs that need guaranteed-clean state (welcome, invites) also
  // re-reset in their own beforeEach hooks — the top-level setup is the
  // belt-and-braces for tests that don't.
  projects: [
    {
      name: "setup",
      testMatch: /reset\.setup\.ts/,
      use: { browserName: "chromium" },
    },
    {
      name: "chromium",
      testIgnore: [/reset\.setup\.ts/],
      dependencies: ["setup"],
      use: { browserName: "chromium" },
    },
  ],
  // Local dev: reuse a running dev server, or spin one up. CI: tests run
  // against the Vercel preview URL.
  webServer: isCI
    ? undefined
    : {
        command: `npm run dev -- --port ${e2ePort}`,
        url: `http://localhost:${e2ePort}`,
        reuseExistingServer: true,
        // Start-fresh path only: `npm run dev` runs dev:db (Supabase ensure +
        // migrate + seed) then a Turbopack compile, which can exceed the 60s
        // default and trip the "bound but not serving" timeout. The reuse path
        // skips the command entirely, so this costs nothing when a server is up.
        timeout: 180_000,
      },
});
