import { expect, test } from "./helpers/fixtures";
import { TIMEOUT_MS } from "./helpers/session";

// These tests exercise the invite UI end-to-end against the worker's
// seeded account. The `member` reset deletes the account's invites
// before each test, so the invite-count assertions hold regardless of
// CI retries or prior tests. /signup is partially stubbed because we
// don't want to drive Inbucket for every run — the magic-link callback
// itself is covered by functional tests.

test.describe("invites — authed member flow", () => {
  test.use({ user: "member" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Invite a friend" }).click();
    await page.waitForURL((u) => u.pathname === "/invites", { timeout: TIMEOUT_MS });
  });

  test("create an invite, see it listed, revoke it", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Invite a new member" })).toBeVisible();

    await page.getByLabel("Who are you inviting?").fill("bringing a friend from the meditation group");
    await page.getByRole("button", { name: "Create invite" }).click();

    const codeLocator = page.locator("code").first();
    await expect(codeLocator).toHaveText(/^[A-HJ-NP-Z2-9]{10}$/);
    await expect(page.getByText("active", { exact: false })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revoke" }).click();

    await expect(page.getByText("revoked", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  });

  test("429 from the API surfaces a friendly cap message", async ({ page }) => {
    // Stub POST /api/invites to return 429 — we don't want to seed
    // fifty real invites per test run, and we only need to verify the
    // UI's error branch for the cap case.
    await page.route("**/api/invites", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({
            error: "too_many_active_invites",
            limit: 50,
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByLabel("Who are you inviting?").fill("this should trigger the cap message");
    await page.getByRole("button", { name: "Create invite" }).click();

    await expect(page.getByText(/You already have 50 active invites/)).toBeVisible();
  });
});

test.describe("/signup — unauthed invite flow", () => {
  test("invalid code shows a specific error message", async ({ page }) => {
    await page.goto("/signup");

    // Link-first intro, and the submit button stays disabled
    // ("Enter invite code…") until a full-length code is present.
    await expect(page.getByText("You've been invited to join!")).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter invite code…" })).toBeDisabled();

    await page.getByLabel("Invite code").fill("ZZZZZZZZZZ");
    await page.getByRole("button", { name: "Sign up!" }).click();
    await expect(page.getByText(/doesn't match any invite/)).toBeVisible();
  });

  test.describe("with an invite from a member", () => {
    test.use({ user: "member" });

    test("valid code → note displayed → submitting email shows 'check your email'", async ({ page, browser }) => {
      // Phase 1: as the member, generate a real invite code.
      await page.goto("/invites");
      await page.getByLabel("Who are you inviting?").fill("e2e signup-flow invite — come on in");
      await page.getByRole("button", { name: "Create invite" }).click();
      const codeLocator = page.locator("code").first();
      await expect(codeLocator).toHaveText(/^[A-HJ-NP-Z2-9]{10}$/);
      const code = ((await codeLocator.textContent()) ?? "").trim();

      // Phase 2: fresh browser context as the unauthed prospective
      // member. A context made by hand inherits this describe's
      // signed-in state unless told otherwise.
      const guestContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const guestPage = await guestContext.newPage();

      try {
        // Intercept only the OTP call — let /api/invites/:code/check hit
        // the real app so it returns the real note from the DB.
        // Note the regex (not a glob): supabase-js sends the redirect URL
        // as ?redirect_to=..., and Playwright's **/auth/v1/otp glob does
        // not match URLs that have a query string. A regex matches both.
        await guestPage.route(/\/auth\/v1\/otp(\?|$)/, (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: {}, error: null }),
          }),
        );

        await guestPage.goto("/signup");
        await guestPage.getByLabel("Invite code").fill(code);
        await guestPage.getByRole("button", { name: "Sign up!" }).click();

        await expect(guestPage.getByText("e2e signup-flow invite — come on in")).toBeVisible();

        await guestPage.getByLabel("Display name").fill("Future Member");
        await guestPage.getByLabel("Email").fill("future-member@testfake.local");
        await guestPage.getByRole("button", { name: "Verify your email" }).click();

        await expect(guestPage.getByText("future-member@testfake.local")).toBeVisible();
        await expect(guestPage.getByText(/Check.*for a sign-in link/)).toBeVisible();
        // The intro line drops away once we switch to the "check your email" state.
        await expect(guestPage.getByText("You've been invited to join!")).toBeHidden();
      } finally {
        await guestContext.close();
      }
    });
  });
});
