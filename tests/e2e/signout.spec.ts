import { expect, test } from "./helpers/fixtures";
import { completeWelcome, signInAs, TIMEOUT_MS } from "./helpers/session";

test("sign-out button signs the user out and lands on /signin", async ({ page }) => {
  await signInAs(page, "regular");
  // A mid-onboarding member is redirected to /welcome, which renders no
  // menu; finish onboarding (if fresh) so the menu is reachable from /.
  // Distinct bio per completeWelcome caller — see the #149 probe.
  if (new URL(page.url()).pathname.startsWith("/welcome")) {
    await completeWelcome(page, { bio: "e2e bio · signout.spec" });
  }

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
