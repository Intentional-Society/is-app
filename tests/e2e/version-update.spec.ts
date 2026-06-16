import { expect, type Page, test } from "@playwright/test";

import { completeWelcome, resetSeededUsers, signInAs, TIMEOUT_MS } from "./helpers/session";

// The live-deploy update UX (docs/strategy-deployment.md): the bottom
// banner for in-app surfaces, and the home page's auto-refresh. We can't
// produce real version skew against a single deployment, so each test stubs
// GET /api/version with a payload the running bundle reads as newer.

test.describe.configure({ mode: "serial" });

const STALE_ID = "e2e-stale-build";
// Older than any real changelog date, so it never reads as a "feature" on
// its own — lets the patch and urgent cases isolate their own tier.
const OLD_APP_VERSION = "2000-01-01";
const EPOCH = "1970-01-01T00:00:00.000Z";

type VersionPayload = { id: string; appVersion: string; urgentReleasedAt: string };

const stubVersion = (page: Page, payload: VersionPayload) =>
  page.route("**/api/version", (route) => route.fulfill({ json: payload }));

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL) throw new Error("version-update.spec.ts: baseURL is not configured");
  await resetSeededUsers(baseURL);
});

test("a feature update shows a dismissible banner on an in-app page", async ({ page }) => {
  await signInAs(page, "regular");
  await completeWelcome(page, { bio: "e2e bio · version-update · feature" });

  // A newer deploy that advanced the changelog → feature → shows immediately.
  await stubVersion(page, { id: STALE_ID, appVersion: "2999-12-31", urgentReleasedAt: EPOCH });

  await page.goto("/me");
  const banner = page.getByText("A new version is available.");
  await expect(banner).toBeVisible({ timeout: TIMEOUT_MS });
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();

  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toBeHidden();
});

test("an urgent update shows a non-dismissible banner", async ({ page }) => {
  await signInAs(page, "regular");
  await completeWelcome(page, { bio: "e2e bio · version-update · urgent" });

  // An urgent marker dated after this build → urgent → non-dismissible.
  await stubVersion(page, { id: STALE_ID, appVersion: OLD_APP_VERSION, urgentReleasedAt: "2999-12-31T00:00:00.000Z" });

  await page.goto("/me");
  await expect(page.getByText("An important update is ready.")).toBeVisible({ timeout: TIMEOUT_MS });
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  // No dismiss control on the urgent tier.
  await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
});

test("the home page auto-reloads a stale tab on arrival", async ({ page }) => {
  await signInAs(page, "regular");
  await completeWelcome(page, { bio: "e2e bio · version-update · home" });

  // A patch-level newer deploy: the banner would hold this 12h, but the home
  // safe-refresh reloads regardless of tier.
  await stubVersion(page, { id: STALE_ID, appVersion: OLD_APP_VERSION, urgentReleasedAt: EPOCH });

  await page.goto("/");
  // The safe-refresh stamps sessionStorage just before reloading; its
  // presence proves the reload fired (and the cooldown then prevents a loop).
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem("is-app:home-refreshed-at")), { timeout: TIMEOUT_MS })
    .not.toBeNull();
});
