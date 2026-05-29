import { expect, test } from "@playwright/test";

import { signInAs } from "./helpers/session";

// Password-reset flow. Like the other auth specs, Supabase's auth
// endpoints are intercepted at the Playwright level so we can drive the
// UI without sending real recovery emails. resetPasswordForEmail is a
// public call and needs no session; only the /auth/reset-password happy
// path does, so that one test signs in first.

const SUPABASE_AUTH = "**/auth/v1/**";

test('"Forgot your password?" navigates to /forgot-password and back', async ({ page }) => {
  await page.goto("/signin");
  // The forgot-password link only renders in the password mode of the
  // sign-in form; default mode is email-link with no link visible.
  await page.getByRole("button", { name: "Sign in with password instead" }).click();
  await page.getByRole("link", { name: "Forgot your password?" }).click();

  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();

  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(/\/signin$/);
});

test("submitting the forgot-password form sends a recovery email and confirms", async ({ page }) => {
  let recoverUrl: string | undefined;

  await page.route(SUPABASE_AUTH, async (route) => {
    const url = route.request().url();
    if (url.includes("/recover")) {
      recoverUrl = url;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({ status: 200, body: "{}" });
  });

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("member@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();

  await expect(page.getByText("Password reset email sent — check your inbox.")).toBeVisible();
  // The form's `redirectTo` is the full callback URL so the email's
  // action link points back at this origin (env-aware). The callback's
  // recovery branch then redirects to /auth/reset-password. The
  // callback URL — not /auth/reset-password — must be on the Supabase
  // redirect allowlist.
  expect(decodeURIComponent(recoverUrl ?? "")).toContain("/auth/callback?type=recovery");
});

test("reset-password rejects a too-short password", async ({ page }) => {
  await page.goto("/auth/reset-password");
  await page.getByLabel("New password").fill("short");
  await page.getByLabel("Confirm password").fill("short");
  await page.getByRole("button", { name: "Set password" }).click();

  await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
});

test("reset-password rejects mismatched passwords", async ({ page }) => {
  await page.goto("/auth/reset-password");
  await page.getByLabel("New password").fill("long-enough-1");
  await page.getByLabel("Confirm password").fill("long-enough-2");
  await page.getByRole("button", { name: "Set password" }).click();

  await expect(page.getByText("Passwords do not match.")).toBeVisible();
});

test("reset-password updates the password and confirms", async ({ page }) => {
  // updateUser requires a session, so we sign in to get one. The PUT is
  // stubbed so the seeded user's real password is never changed — a
  // normal session stands in for the recovery session here, since the
  // form's success branch doesn't depend on which kind it is.
  await signInAs(page, "regular");

  await page.route(SUPABASE_AUTH, async (route) => {
    const req = route.request();
    if (req.method() === "PUT" && req.url().includes("/user")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "00000000-0000-0000-0000-000000000000",
          email: "e2e-regular@testfake.local",
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/auth/reset-password");
  await page.getByLabel("New password").fill("a-fresh-password-123");
  await page.getByLabel("Confirm password").fill("a-fresh-password-123");
  await page.getByRole("button", { name: "Set password" }).click();

  await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();
});
