import { expect, test } from "@playwright/test";

import { resetSeededUsers, signInAs } from "./helpers/session";

// Phase 2 backfill: verify that a fresh user lands on /welcome, can
// save the form, and is then allowed through to / where the invite
// panel is visible. Both tests in this file depend on the regular
// seeded user having bio=null, so we re-run the reset per-test to
// survive CI retries cleanly.

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL) throw new Error("welcome.spec.ts: baseURL is not configured");
  await resetSeededUsers(baseURL);
});

// Declared BEFORE the happy-path test so the file's final state leaves
// regular with bio filled — downstream specs in the chromium project
// expect to land on / rather than bouncing through /welcome.
test("welcome form surfaces a validation failure instead of getting stuck", async ({
  page,
}) => {
  await signInAs(page, "regular");
  await page.waitForURL((u) => u.pathname === "/welcome", { timeout: 10_000 });

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
  expect(page.url()).toContain("/welcome");
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
});

test("fresh user lands on /welcome and can complete their profile", async ({
  page,
}) => {
  await signInAs(page, "regular");
  await page.waitForURL((u) => u.pathname === "/welcome", { timeout: 10_000 });

  await page.getByLabel("Display name").fill("Welcome Tester");
  await page.getByLabel("Bio").fill("Loves writing, hikes, long coffees.");
  await page
    .getByLabel("Keywords (comma-separated)")
    .fill("writing, coffee, hiking");
  await page.getByLabel("Location").fill("Lisbon");

  await page.getByRole("button", { name: "Save" }).click();

  await page.waitForURL((u) => u.pathname === "/", { timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: "Invite a member" }),
  ).toBeVisible();
});
