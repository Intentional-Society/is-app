import { expect, test } from "@playwright/test";

import {
  completeWelcome,
  deleteTestUser,
  signInAsNewUser,
} from "./helpers/session";

test("GET /logout signs the user out and lands on /login", async ({
  page,
}) => {
  const user = await signInAsNewUser(page, "logout");
  try {
    await completeWelcome(page, { displayName: "Logout Tester" });

    await page.goto("/logout");
    await page.waitForURL((url) => url.pathname === "/login", {
      timeout: 10_000,
    });

    // Confirm the session really is gone — / should bounce us back to
    // /login rather than re-render the authed home page.
    await page.goto("/");
    await page.waitForURL((url) => url.pathname === "/login", {
      timeout: 10_000,
    });
    await expect(page.getByLabel("Email")).toBeVisible();
  } finally {
    await deleteTestUser(user.id);
  }
});

test("GET /logout works even with no session", async ({ page }) => {
  await page.goto("/logout");
  await page.waitForURL((url) => url.pathname === "/login", {
    timeout: 10_000,
  });
});
