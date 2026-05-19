import { expect, type Page, test } from "@playwright/test";

import { resetSeededUsers, signInAs } from "./helpers/session";

// Smoke test for the admin surface: the seeded admin user can reach the
// /admin hub and the /admin/programs page, and neither logs a console
// error nor throws an uncaught exception. Deliberately shallow — it
// guards against the admin pages crashing on load (a broken import, a
// server-component throw, a failed client fetch) without coupling to
// their content. Deeper program-admin behaviour is covered by the
// functional tests in tests/functional/server/admin-programs.test.ts.
//
// Requires e2e-admin@testfake.local to have is_admin = true in the
// target database — otherwise /admin and /admin/programs call
// notFound() and the status assertions below fail fast. See
// docs/doc-supabase.md.

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

  const response = await page.goto("/admin");
  // /admin calls notFound() for non-admins, so a 404 here means the
  // seeded admin user has lost (or never had) its is_admin flag.
  expect(response?.status(), "/admin returned 404 — is e2e-admin still flagged is_admin?").toBe(200);

  await expect(page.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage programs" })).toBeVisible();
  // AdminHints settling out of its "Loading…" state means its
  // /api/admin/hints query resolved — any client-side error has had its
  // chance to land in `errors`.
  await expect(page.getByText("Loading…")).toBeHidden();
  expect(errors).toEqual([]);
});

test("admin can open the /admin/programs page without console errors", async ({ page }) => {
  await signInAs(page, "admin");
  const errors = collectPageErrors(page);

  const response = await page.goto("/admin/programs");
  expect(response?.status(), "/admin/programs returned 404 — is e2e-admin still flagged is_admin?").toBe(200);

  await expect(page.getByRole("heading", { name: "Programs", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create program" })).toBeVisible();
  await expect(page.getByText("Loading…")).toBeHidden();
  expect(errors).toEqual([]);
});
