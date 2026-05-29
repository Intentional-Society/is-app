import { expect, test } from "@playwright/test";

import { completeWelcome, resetSeededUsers, signInAs, TIMEOUT_MS } from "./helpers/session";

// Exercises the history-aware breadcrumb back link from #274. /profile
// is one of the multi-entry pages: reachable from /, /myweb, the nav
// menu, etc. The back link should follow the user's actual route when
// an in-app referrer exists, and fall back to the per-page default
// when it doesn't.
test.describe.configure({ mode: "serial" });

test.describe("/profile — breadcrumb back link", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("breadcrumb.spec.ts: baseURL is not configured");
    await resetSeededUsers(baseURL);
    // Pre-dismiss the /myweb welcome tour so it doesn't intercept
    // navigation in the /myweb → /profile flow below.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("isweb-welcome-tour-dismissed", "1");
    });
  });

  test("/myweb → /profile renders '← My web' and returns there", async ({ page }) => {
    await signInAs(page, "regular");
    // Distinct bio per completeWelcome caller — see the #149 probe.
    await completeWelcome(page, { bio: "e2e bio · breadcrumb.spec · myweb-to-profile" });

    await page.goto("/myweb");
    await page.waitForURL((u) => u.pathname === "/myweb", { timeout: TIMEOUT_MS });
    await expect(page.getByRole("heading", { name: "My web" })).toBeVisible();

    await page.goto("/profile");
    await page.waitForURL((u) => u.pathname === "/profile", { timeout: TIMEOUT_MS });
    await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();

    const back = page.getByRole("link", { name: "← My web", exact: true });
    await expect(back).toHaveAttribute("href", "/myweb");
    await back.click();
    await page.waitForURL((u) => u.pathname === "/myweb", { timeout: TIMEOUT_MS });
  });

  test("direct landing on /profile falls back to '← Home'", async ({ page }) => {
    await signInAs(page, "regular");
    // Distinct bio per completeWelcome caller — see the #149 probe.
    await completeWelcome(page, { bio: "e2e bio · breadcrumb.spec · direct-profile" });

    // Drop the welcome-flow history so this navigation is the user's
    // only in-app entry, simulating a deep link from outside the app.
    await page.evaluate(() => window.sessionStorage.removeItem("isweb-nav-history"));

    await page.goto("/profile");
    await page.waitForURL((u) => u.pathname === "/profile", { timeout: TIMEOUT_MS });

    const back = page.getByRole("link", { name: "← Home", exact: true });
    await expect(back).toHaveAttribute("href", "/");
  });
});
