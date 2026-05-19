import { expect, type Page, test } from "@playwright/test";

import { resetSeededUsers, signInAs } from "./helpers/session";

// Smoke test for the admin surface: the seeded admin user can reach the
// /admin hub and the /admin/programs page, and neither logs a console
// error nor throws an uncaught exception. Deliberately shallow — it
// guards against the admin pages crashing on load (a broken import, a
// server-component throw, a failed client fetch) without coupling to
// their content. Deeper program-admin behaviour is covered by the
// functional tests in tests/functional/server/admin-programs.test.ts.

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL) throw new Error("admin.spec.ts: baseURL is not configured");
  await resetSeededUsers(baseURL);
});

// Records console errors and uncaught page exceptions from the moment it
// is attached. Attach it after sign-in so the listener only sees the
// page under test, not sign-in/redirect noise.
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return errors;
}

test("admin can open the /admin hub without console errors", async ({ page }) => {
  await signInAs(page, "admin");
  const errors = collectPageErrors(page);

  // The hub's AdminHints panel fetches /api/admin/hints on mount; wait
  // for it so a client-side failure has a chance to surface.
  const hintsLoaded = page.waitForResponse((r) => r.url().includes("/api/admin/hints"));
  await page.goto("/admin");
  await hintsLoaded;

  await expect(page.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage programs" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("admin can open the /admin/programs page without console errors", async ({ page }) => {
  await signInAs(page, "admin");
  const errors = collectPageErrors(page);

  const programsLoaded = page.waitForResponse((r) => r.url().includes("/api/admin/programs"));
  await page.goto("/admin/programs");
  await programsLoaded;

  await expect(page.getByRole("heading", { name: "Programs", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create program" })).toBeVisible();
  expect(errors).toEqual([]);
});
