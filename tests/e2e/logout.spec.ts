import { expect, test } from "@playwright/test";

import { signInAs } from "./helpers/session";

test("sign-out button signs the user out and lands on /login", async ({ page }) => {
  await signInAs(page, "regular");

  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/login", {
    timeout: 10_000,
  });

  // Confirm the session really is gone.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});
