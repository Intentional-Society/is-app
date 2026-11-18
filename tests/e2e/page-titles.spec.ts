import { expect, test } from "./helpers/fixtures";

// Every page sets a distinct <title> ("IS Web: <page>") so the browser
// history stack and tab strip stay scannable (issue #425). This covers
// the root-layout title template, a few static page titles, the
// home-page default (bare brand, no prefix), and a dynamic title from
// members/[id]'s generateMetadata.
test.describe("page titles", () => {
  test("public pages carry distinct, prefixed titles", async ({ page }) => {
    await page.goto("/signin");
    await expect(page).toHaveTitle("IS Web: Sign in");

    await page.goto("/signup");
    await expect(page).toHaveTitle("IS Web: Sign up");

    await page.goto("/forgot-password");
    await expect(page).toHaveTitle("IS Web: Forgot password");
  });

  test.describe("signed in", () => {
    test.use({ user: "member" });

    test("authed pages carry distinct titles, including a dynamic generateMetadata title", async ({ page }) => {
      // Home keeps the bare brand: it sets no title, so it falls back to
      // the template default rather than getting the "IS Web: " prefix.
      await page.goto("/");
      await expect(page).toHaveTitle("Intentional Society Web App");

      await page.goto("/members");
      await expect(page).toHaveTitle("IS Web: Member directory");

      await page.goto("/intentions");
      await expect(page).toHaveTitle("IS Web: Current intentions");

      // Dynamic title from members/[id]'s generateMetadata (not a static
      // metadata export). We can't assert a real member's name — the only
      // seeded members we control are hidden, and a hidden profile 404s
      // from /members/:id, so its page is unviewable — so assert the
      // deterministic not-found branch, which still proves
      // generateMetadata drives the title.
      await page.goto("/members/no-such-member-page-titles-e2e");
      await expect(page).toHaveTitle("IS Web: Member not found");
    });
  });
});
