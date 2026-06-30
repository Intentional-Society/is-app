import { expect, test } from "./helpers/fixtures";
import { completeWelcome, resetSeededUsers, signInAs } from "./helpers/session";

// Every page sets a distinct <title> ("IS Web: <page>") so the browser
// history stack and tab strip stay scannable (issue #425). This covers
// the root-layout title template, a few static page titles, the
// home-page default (bare brand, no prefix), and a dynamic title from
// members/[id]'s generateMetadata.
test.describe.configure({ mode: "serial" });

test.describe("page titles", () => {
  test.beforeEach(async ({ baseURL }) => {
    if (!baseURL) throw new Error("page-titles.spec.ts: baseURL is not configured");
    await resetSeededUsers(baseURL);
  });

  test("public pages carry distinct, prefixed titles", async ({ page }) => {
    await page.goto("/signin");
    await expect(page).toHaveTitle("IS Web: Sign in");

    await page.goto("/signup");
    await expect(page).toHaveTitle("IS Web: Sign up");

    await page.goto("/forgot-password");
    await expect(page).toHaveTitle("IS Web: Forgot password");
  });

  test("authed pages carry distinct titles, including a dynamic generateMetadata title", async ({ page }) => {
    await signInAs(page, "regular");
    // Onboard so "/" stops redirecting into the welcome flow; the distinct
    // bio keeps the #149 reset probe happy (one bio per completeWelcome caller).
    await completeWelcome(page, { bio: "e2e bio · page-titles.spec · dynamic title" });

    // Home keeps the bare brand: it sets no title, so it falls back to
    // the template default rather than getting the "IS Web: " prefix.
    await expect(page).toHaveTitle("Intentional Society Web App");

    await page.goto("/members");
    await expect(page).toHaveTitle("IS Web: Member directory");

    await page.goto("/intentions");
    await expect(page).toHaveTitle("IS Web: Current intentions");

    // Dynamic title from members/[id]'s generateMetadata (not a static
    // metadata export). We can't assert a real member's name on the
    // preview — the only seeded member we control is hidden on prod, and a
    // hidden profile 404s from /members/:id, so its page is unviewable —
    // so assert the deterministic not-found branch, which still proves
    // generateMetadata drives the title.
    await page.goto("/members/no-such-member-page-titles-e2e");
    await expect(page).toHaveTitle("IS Web: Member not found");
  });
});
