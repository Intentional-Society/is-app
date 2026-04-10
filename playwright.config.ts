import { defineConfig } from "@playwright/test";

const isCI = !!process.env.CI;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3093";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
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
  projects: [
    {
      name: "chromium",
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
