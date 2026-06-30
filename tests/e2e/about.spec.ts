import { expect, test } from "./helpers/fixtures";
import { completeWelcome, resetSeededUsers, signInAs, TIMEOUT_MS } from "./helpers/session";

// Smoke coverage of the /about page: the sidebar link reaches it, and
// the version line, changelog, and team blurb render.
test.describe.configure({ mode: "serial" });

test.describe("/about page", () => {
  test.beforeEach(async ({ baseURL }) => {
    if (!baseURL) throw new Error("about.spec.ts: baseURL is not configured");
    await resetSeededUsers(baseURL);
  });

  test("the menu link opens /about and the changelog renders", async ({ page }) => {
    await signInAs(page, "regular");
    // Distinct bio per completeWelcome caller — see the #149 probe.
    await completeWelcome(page, { bio: "e2e bio · about.spec · changelog" });

    // The link lives only in the hamburger menu (no home-page card).
    // Menu items render via SheetClose, which exposes them with
    // role="button" (not link), the same as every other menu entry.
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "About", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/about", { timeout: TIMEOUT_MS });

    await expect(page.getByRole("heading", { name: "About", exact: true })).toBeVisible();
    // Version line: the date of the newest entry, e.g. "v2026.05.29".
    await expect(page.getByText(/^v\d{4}\.\d{2}\.\d{2}$/)).toBeVisible();
    // System Metrics is the top section, Changelog below it. Both are
    // collapsed <details> by default, so their summary headings show but
    // their bodies stay hidden until expanded.
    await expect(page.getByRole("heading", { name: "System Metrics", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Changelog", exact: true })).toBeVisible();
    // Expand the changelog; a stable seed entry then renders.
    await page.getByRole("heading", { name: "Changelog", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Profile pictures", exact: true })).toBeVisible();
  });
});
