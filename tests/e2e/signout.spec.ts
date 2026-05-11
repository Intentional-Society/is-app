import { expect, test } from "@playwright/test";

import { signInAs, TIMEOUT_MS } from "./helpers/session";

test("sign-out button signs the user out and lands on /signin", async ({ page }) => {
  await signInAs(page, "regular");

  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/signin", {
    timeout: TIMEOUT_MS,
  });

  // Confirm the session really is gone.
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
