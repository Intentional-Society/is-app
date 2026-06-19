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

// We don't visit the public /members/[slug] page to confirm the change: the
// seeded accounts are hidden on the prod DB that previews share, and a hidden
// profile 404s from /members/:id for everyone (admins included), so that page
// is unviewable in CI. Instead, a full reload proves the slug persisted —
// the settings form re-hydrates from the saved value.
test("a member can change their profile URL from settings", async ({ page }) => {
  await signInAs(page, "regular");
  // Distinct bio per completeWelcome caller — see the #149 probe.
  await completeWelcome(page, { displayName: "Slug Tester", bio: "e2e bio · me.spec · slug" });

  await page.goto("/me#settings");
  await expect(page.getByRole("heading", { name: "Profile URL" })).toBeVisible();

  await page.getByLabel("Profile URL").fill("E2E Slug Tester!");
  // The helper text previews the server-side normalization live.
  await expect(page.getByText("/members/e2e-slug-tester")).toBeVisible();
  await page.getByRole("button", { name: "Update URL" }).click();
  await expect(page.getByText("Profile URL updated")).toBeVisible();

  // A full reload re-fetches the profile, so the form re-hydrates with the
  // saved slug — the field and the live preview both reflect it.
  await page.reload();
  await expect(page.getByLabel("Profile URL")).toHaveValue("e2e-slug-tester");
  await expect(page.getByText("/members/e2e-slug-tester")).toBeVisible();
});
