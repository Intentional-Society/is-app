import { expect, test } from "@playwright/test";

import { completeWelcome, resetSeededUsers, signInAs } from "./helpers/session";

// These tests exercise the authed invite UI end-to-end against the
// regular seeded user. Each test in the authed describe resets the
// user's state first so the invite-count assertions hold regardless
// of CI retries or prior tests. /signup is partially stubbed because
// we don't want to drive Inbucket for every run — the magic-link
// callback itself is covered by functional tests.
//
// Serial mode: all the authed tests in this file share the regular
// user, so parallel runs would race on beforeEach resets / invite
// creation. Local Playwright defaults to workers > 1; CI runs single-
// worker regardless.
test.describe.configure({ mode: "serial" });

test.describe("invites — authed member flow", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("invites.spec.ts: baseURL is not configured");
    await resetSeededUsers(baseURL);
    await signInAs(page, "regular");
    await completeWelcome(page, { displayName: "Member Under Test" });
  });

  test("create an invite, see it listed, revoke it", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Invite a member" }),
    ).toBeVisible();

    await page
      .getByLabel(/Note \(for your records/)
      .fill("bringing a friend from the meditation group");
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
    // ten real invites per test run, and we only need to verify the
    // UI's error branch for the cap case.
    await page.route("**/api/invites", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({
            error: "too_many_active_invites",
            limit: 10,
          }),
        });
        return;
      }
      await route.continue();
    });

    await page
      .getByLabel(/Note \(for your records/)
      .fill("this should trigger the cap message");
    await page.getByRole("button", { name: "Create invite" }).click();

    await expect(
      page.getByText(/You already have 10 active invites/),
    ).toBeVisible();
  });
});

test.describe("/signup — unauthed invite flow", () => {
  test("invalid code shows a specific error message", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Invite code").fill("ZZZZZZZZZZ");
    await page.getByRole("button", { name: "Check code" }).click();
    await expect(page.getByText(/doesn't match any invite/)).toBeVisible();
  });

  test("valid code → note displayed → submitting email shows 'check your email'", async ({
    browser,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("invites.spec.ts: baseURL is not configured");
    await resetSeededUsers(baseURL);

    // Phase 1: as the regular member, generate a real invite code.
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    let code: string;
    try {
      await signInAs(memberPage, "regular");
      await completeWelcome(memberPage, { displayName: "Inviter" });
      await memberPage
        .getByLabel(/Note \(for your records/)
        .fill("e2e signup-flow invite — come on in");
      await memberPage.getByRole("button", { name: "Create invite" }).click();
      const codeLocator = memberPage.locator("code").first();
      await expect(codeLocator).toHaveText(/^[A-HJ-NP-Z2-9]{10}$/);
      code = (await codeLocator.textContent())!.trim();
    } finally {
      await memberContext.close();
    }

    // Phase 2: fresh browser context as the unauthed prospective member.
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    try {
      // Intercept only the OTP call — let /api/invites/:code/check hit
      // the real app so it returns the real note from the DB.
      await guestPage.route("**/auth/v1/otp", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: {}, error: null }),
        }),
      );

      await guestPage.goto("/signup");
      await guestPage.getByLabel("Invite code").fill(code);
      await guestPage.getByRole("button", { name: "Check code" }).click();

      await expect(
        guestPage.getByText("e2e signup-flow invite — come on in"),
      ).toBeVisible();

      await guestPage.getByLabel("Display name").fill("Future Member");
      await guestPage.getByLabel("Email").fill("future-member@testfake.local");
      await guestPage
        .getByRole("button", { name: "Send sign-in link" })
        .click();

      await expect(
        guestPage.getByText("future-member@testfake.local"),
      ).toBeVisible();
      await expect(
        guestPage.getByText(/Check.*for a sign-in link/),
      ).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });
});
