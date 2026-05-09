import { expect, test } from "@playwright/test";

import { completeWelcome, resetSeededUsers, signInAs } from "./helpers/session";

// Smoke coverage of /myweb's wiring: page loads, the WebBuilder
// suggestion feed renders, the Done button toggles into View mode and
// the Edit button toggles back. The rich rating-flow path is left to
// PR 4's e2e once the welcome tour seeds enough relational data to
// drive a populated suggestion feed.

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL) throw new Error("myweb.spec.ts: baseURL is not configured");
  await resetSeededUsers(baseURL);
});

test("/myweb loads, Done flips into View, Edit flips back", async ({ page }) => {
  await signInAs(page, "regular");
  await completeWelcome(page);

  await page.getByRole("button", { name: "My web" }).click();
  await page.waitForURL((u) => u.pathname === "/myweb", { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "My web" })).toBeVisible();

  // Edit mode is the first-visit default (lastUpdatedWeb IS NULL): the
  // builder, "Other members" heading, and Done button are all present.
  await expect(page.getByRole("heading", { name: "Other members" })).toBeVisible();
  const doneButton = page.getByRole("button", { name: "Done" });
  await expect(doneButton).toBeVisible();

  await doneButton.click();
  // After PUT /api/me/last-updated-web returns, mode flips to View and
  // the builder vanishes; only the Edit button remains under the graph.
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Other members" })).toBeHidden();

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Other members" })).toBeVisible();
});
