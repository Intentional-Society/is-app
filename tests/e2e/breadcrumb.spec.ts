import { expect, test } from "./helpers/fixtures";
import { TIMEOUT_MS } from "./helpers/session";

// Exercises the history-aware breadcrumb back link from #274. /me
// is one of the multi-entry pages: reachable from /, /myweb, the nav
// menu, etc. The back link should follow the user's actual route when
// an in-app referrer exists, and fall back to the per-page default
// when it doesn't.
test.use({ user: "member" });

test.describe("/me — breadcrumb back link", () => {
  test.beforeEach(async ({ page }) => {
    // Pre-dismiss the /myweb welcome tour so it doesn't intercept
    // navigation in the /myweb → /me flow below.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("isweb-welcome-tour-dismissed", "1");
    });
  });

  test("/myweb → /me renders '← My web' and returns there", async ({ page }) => {
    await page.goto("/myweb");
    await page.waitForURL((u) => u.pathname === "/myweb", { timeout: TIMEOUT_MS });
    await expect(page.getByRole("heading", { name: "My web" })).toBeVisible();

    await page.goto("/me");
    await page.waitForURL((u) => u.pathname === "/me", { timeout: TIMEOUT_MS });
    await expect(page.getByRole("heading", { name: "My page" })).toBeVisible();

    const back = page.getByRole("link", { name: "← My web", exact: true });
    await expect(back).toHaveAttribute("href", "/myweb");
    await back.click();
    await page.waitForURL((u) => u.pathname === "/myweb", { timeout: TIMEOUT_MS });
  });

  test("direct landing on /me falls back to '← Home'", async ({ page }) => {
    // The page's first navigation, so /me is the member's only in-app
    // entry — a deep link from outside the app.
    await page.goto("/me");
    await page.waitForURL((u) => u.pathname === "/me", { timeout: TIMEOUT_MS });

    const back = page.getByRole("link", { name: "← Home", exact: true });
    await expect(back).toHaveAttribute("href", "/");
  });
});
