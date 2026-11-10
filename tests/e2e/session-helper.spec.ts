import { expect, test } from "./helpers/fixtures";

// Sanity test for the saved session itself. Signed-in specs build on
// it — if the browser state the setup project saved doesn't carry a
// session, the rest of the signed-in e2e surface is meaningless.

test.use({ user: "member" });

test("the saved session lands a member on the signed-in home page", async ({ page }) => {
  await page.goto("/");
  // `/` serves both homes at the same URL; the greeting and the menu
  // render only for a signed-in member.
  await expect(page.getByText("What would you like to do?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
});
