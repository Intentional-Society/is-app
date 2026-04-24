import { expect, test } from "@playwright/test";

import { signInAs } from "./helpers/session";

test("GET /logout signs the user out and lands on /login", async ({ page }) => {
  await signInAs(page, "regular");

  await page.goto("/logout");
  await page.waitForURL((url) => url.pathname === "/login", {
    timeout: 10_000,
  });

  // Confirm the session really is gone — / should show the logged-out
  // home page rather than the authed view.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("GET /logout works even with no session", async ({ page }) => {
  await page.goto("/logout");
  await page.waitForURL((url) => url.pathname === "/login", {
    timeout: 10_000,
  });
});
