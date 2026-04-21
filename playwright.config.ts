import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load .env.local so the e2e session helper + reset-endpoint client
// can pick up the seeded user passwords and the CI reset token.
// Harmless in CI where the vars come from the environment instead.
loadEnv({ path: ".env.local", quiet: true });

const isCI = !!process.env.CI;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3093";

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
  // Local dev: spin up a Next.js server. CI: tests run against Vercel preview URL.
  webServer: isCI
    ? undefined
    : {
        command: "npm run dev -- --port 3093",
        url: "http://localhost:3093",
        reuseExistingServer: true,
      },
});
