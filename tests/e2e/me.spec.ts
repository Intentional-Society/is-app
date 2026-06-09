import { expect, test } from "@playwright/test";

import { completeWelcome, resetSeededUsers, signInAs, TIMEOUT_MS } from "./helpers/session";

// The /me page (#376): anchor-linked Profile/Settings tabs, the
// light/dark/system theme selector, and the editable profile URL
// (#188 — slugs are stable, changed only here).

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL) throw new Error("me.spec.ts: baseURL is not configured");
  await resetSeededUsers(baseURL);
});

test("tabs switch between profile and settings, and a theme choice persists", async ({ page }) => {
  await signInAs(page, "regular");
  // Distinct bio per completeWelcome caller — see the #149 probe.
  await completeWelcome(page, { bio: "e2e bio · me.spec · tabs-theme" });

  await page.goto("/me");
  await page.waitForURL((u) => u.pathname === "/me", { timeout: TIMEOUT_MS });

  // Profile tab is the default and opens in editing mode.
  await expect(page.getByLabel("Display name")).toBeVisible();

  // The Settings anchor tab swaps the panels without a navigation.
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible();
  await expect(page.getByLabel("Display name")).toBeHidden();

  // Dark applies immediately (ThemeSelector) and survives a reload
  // (ThemeScript reading localStorage before paint).
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);

  // The #settings hash survived the reload, so the selector is still
  // on screen for the switch back to light.
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

// Runs as the admin user: the seeded accounts are hidden in the prod
// DB that previews share, and /members/[id] resolves hidden profiles
// only for admin viewers — a regular seeded user would get "Member
// not found" on their own page in CI.
test("a member can change their profile URL from settings", async ({ page }) => {
  await signInAs(page, "admin");
  // Distinct bio per completeWelcome caller — see the #149 probe.
  await completeWelcome(page, { displayName: "Slug Tester", bio: "e2e bio · me.spec · slug" });

  await page.goto("/me#settings");
  await expect(page.getByRole("heading", { name: "Profile URL" })).toBeVisible();

  await page.getByLabel("Profile URL").fill("E2E Slug Tester!");
  // The helper text previews the server-side normalization live.
  await expect(page.getByText("/members/e2e-slug-tester")).toBeVisible();
  await page.getByRole("button", { name: "Update URL" }).click();
  await expect(page.getByText("Profile URL updated")).toBeVisible();

  // The new slug resolves in the member directory.
  await page.goto("/members/e2e-slug-tester");
  await page.waitForURL((u) => u.pathname === "/members/e2e-slug-tester", { timeout: TIMEOUT_MS });
  await expect(page.getByRole("heading", { name: "Slug Tester" })).toBeVisible();
});
