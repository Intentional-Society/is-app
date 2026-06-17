import { expect, test } from "@playwright/test";

import { completeWelcome, resetSeededUsers, signInAs, TIMEOUT_MS } from "./helpers/session";

// Every page sets a distinct <title> ("IS Web: <page>") so the browser
// history stack and tab strip stay scannable (issue #425). This covers
// the root-layout title template, a few static page titles, the
// home-page default (bare brand, no prefix), and a dynamic member title
// produced by generateMetadata.
test.describe.configure({ mode: "serial" });

test.describe("page titles", () => {
  test.beforeEach(async ({ baseURL }) => {
    if (!baseURL) throw new Error("page-titles.spec.ts: baseURL is not configured");
    await resetSeededUsers(baseURL);
  });

  test("public pages carry distinct, prefixed titles", async ({ page }) => {
    await page.goto("/signin");
    await expect(page).toHaveTitle("IS Web: Sign in");

    await page.goto("/signup");
    await expect(page).toHaveTitle("IS Web: Sign up");

    await page.goto("/forgot-password");
    await expect(page).toHaveTitle("IS Web: Forgot password");
  });

  test("authed pages carry distinct titles, including the dynamic member name", async ({ page }) => {
    await signInAs(page, "regular");
    await completeWelcome(page, { displayName: "Tessa Titles", bio: "e2e bio · page-titles.spec · member title" });

    // Home keeps the bare brand: it sets no title, so it falls back to
    // the template default rather than getting the "IS Web: " prefix.
    await expect(page).toHaveTitle("Intentional Society Web App");

    await page.goto("/members");
    await expect(page).toHaveTitle("IS Web: Member directory");

    await page.goto("/intentions");
    await expect(page).toHaveTitle("IS Web: Current intentions");

    // Dynamic title from generateMetadata: filter the directory to the
    // seeded member, open their profile, and the title reflects their
    // display name.
    await page.goto("/members");
    await page.getByRole("searchbox").fill("Tessa Titles");
    await page.getByRole("link", { name: /Tessa Titles/ }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/members/"), { timeout: TIMEOUT_MS });
    await expect(page).toHaveTitle("IS Web: Tessa Titles");
  });
});
