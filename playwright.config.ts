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
