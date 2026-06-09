import { expect, test } from "@playwright/test";

import { resetSeededUsers, signInAs, TIMEOUT_MS } from "./helpers/session";

// The multi-step welcome flow (#166): a fresh user is routed through
// agreements → profile → programs, then handed off to /myweb. Both tests
// depend on the regular seeded user starting with no welcome markers, so
// we re-reset per-test to survive CI retries cleanly.

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL) throw new Error("welcome.spec.ts: baseURL is not configured");
  await resetSeededUsers(baseURL);
});

// Declared BEFORE the happy-path test so the file's final state leaves
// the regular user fully onboarded.
test("welcome profile step surfaces a validation failure instead of getting stuck", async ({ page }) => {
  await signInAs(page, "regular");

  // Pass the agreements step to reach the profile form.
  await page.waitForURL((u) => u.pathname === "/welcome/agreements", { timeout: TIMEOUT_MS });
  await page.getByRole("button", { name: "I agree" }).click();
  await page.waitForURL((u) => u.pathname === "/welcome/profile", { timeout: TIMEOUT_MS });

  // Force PUT /api/me to fail. The glob matches /api/me exactly, not
  // /api/me/last-signed-agreements, so the agreements click above ran
  // against the real endpoint.
  await page.route("**/api/me", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "forced failure for e2e" }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByLabel("Display name").fill("Error Tester");
  await page.getByLabel("Bio").fill("This should fail on save.");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("forced failure for e2e")).toBeVisible();
  expect(page.url()).toContain("/welcome/profile");
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
});

test("fresh user completes the welcome flow end to end", async ({ page }) => {
  await signInAs(page, "regular");

  // Step 1 — agreements.
  await page.waitForURL((u) => u.pathname === "/welcome/agreements", { timeout: TIMEOUT_MS });
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await page.getByRole("button", { name: "I agree" }).click();

  // Step 2 — profile.
  await page.waitForURL((u) => u.pathname === "/welcome/profile", { timeout: TIMEOUT_MS });
  await page.getByLabel("Display name").fill("Welcome Tester");
  await page.getByLabel("Bio").fill("Loves writing, hikes, long coffees.");
  await page.getByLabel("Keywords (comma-separated)").fill("writing, coffee, hiking");
  await page.getByLabel("Location").fill("Lisbon");
  await page.getByRole("button", { name: "Save" }).click();

  // Saving reveals the one-step settings tour (its title doubles as the
  // save confirmation); the spotlighted Settings tab holds the welcome
  // variant of the /me settings (no deactivate).
  await expect(page.getByText("Profile saved!")).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deactivate account" })).toBeHidden();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3 — programs.
  await page.waitForURL((u) => u.pathname === "/welcome/programs", { timeout: TIMEOUT_MS });
  await page.getByRole("button", { name: "Done", exact: true }).click();

  // Onboarding complete — the flow hands off to /myweb.
  await page.waitForURL((u) => u.pathname === "/myweb", { timeout: TIMEOUT_MS });
  await expect(page.getByRole("heading", { name: "My web" })).toBeVisible();
});
