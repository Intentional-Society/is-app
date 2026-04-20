import { expect, test } from "@playwright/test";

import { deleteTestUser, signInAsNewUser } from "./helpers/session";

// Phase 2 backfill: verify that a fresh user lands on /welcome, can
// save the form, and is then allowed through to / where the invite
// panel is visible.

test("fresh user lands on /welcome and can complete their profile", async ({
  page,
}) => {
  const user = await signInAsNewUser(page, "welcome-flow");
  try {
    // Fresh user: bio is null → / redirects to /welcome.
    await page.waitForURL((url) => url.pathname === "/welcome", {
      timeout: 10_000,
    });

    await page.getByLabel("Display name").fill("Welcome Tester");
    await page.getByLabel("Bio").fill("Loves writing, hikes, long coffees.");
    await page
      .getByLabel("Keywords (comma-separated)")
      .fill("writing, coffee, hiking");
    await page.getByLabel("Location").fill("Lisbon");

    await page.getByRole("button", { name: "Save" }).click();

    // After save, we land on /. The invite panel proves the profile
    // sentinel (bio) is no longer null.
    await page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: "Invite a member" }),
    ).toBeVisible();
  } finally {
    await deleteTestUser(user.id);
  }
});

test("welcome form surfaces a validation failure instead of getting stuck", async ({
  page,
}) => {
  const user = await signInAsNewUser(page, "welcome-err");
  try {
    await page.waitForURL((url) => url.pathname === "/welcome", {
      timeout: 10_000,
    });

    // Force the PUT /api/me to fail so we exercise the error branch.
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
    // Still on /welcome — didn't navigate.
    expect(page.url()).toContain("/welcome");
    // Button is released, not stuck on "Saving…".
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  } finally {
    await deleteTestUser(user.id);
  }
});
