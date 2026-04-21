import { expect, test } from "@playwright/test";

// /login is public, so these tests run without a session. The Supabase
// auth endpoints are intercepted at the Playwright level, which lets us
// verify which method the form chooses (password vs magic link) without
// needing a real session-minting helper (that's Phase 3's territory).

const SUPABASE_AUTH = "**/auth/v1/**";

test("password provided → signInWithPassword is called", async ({ page }) => {
  let sawPasswordCall = false;
  let sawOtpCall = false;

  await page.route(SUPABASE_AUTH, async (route) => {
    const url = route.request().url();
    if (url.includes("/token") && url.includes("grant_type=password")) {
      sawPasswordCall = true;
      // Return a plausible-looking error so the form stops on the
      // password branch and does not proceed to a real sign-in.
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid login credentials",
        }),
      });
      return;
    }
    if (url.includes("/otp")) {
      sawOtpCall = true;
    }
    await route.fulfill({ status: 200, body: "{}" });
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill("member@example.test");
  await page.getByLabel("Password (optional)").fill("hunter2");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Next.js renders a hidden route-announcer with role="alert" too, so
  // we target our error message by text rather than by role.
  await expect(page.getByText("Invalid login credentials")).toBeVisible();
  expect(sawPasswordCall).toBe(true);
  expect(sawOtpCall).toBe(false);
});

test("password blank → signInWithOtp is called", async ({ page }) => {
  let sawPasswordCall = false;
  let sawOtpCall = false;

  await page.route(SUPABASE_AUTH, async (route) => {
    const url = route.request().url();
    if (url.includes("/token") && url.includes("grant_type=password")) {
      sawPasswordCall = true;
    }
    if (url.includes("/otp")) {
      sawOtpCall = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {}, error: null }),
      });
      return;
    }
    await route.fulfill({ status: 200, body: "{}" });
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill("member@example.test");
  // Leave password blank intentionally.
  await page.getByRole("button", { name: "Send sign-in link" }).click();

  await expect(
    page.getByText("Check member@example.test for a sign-in link."),
  ).toBeVisible();
  expect(sawOtpCall).toBe(true);
  expect(sawPasswordCall).toBe(false);
});

test("unknown email on magic-link surfaces the otp_disabled error", async ({
  page,
}) => {
  // With shouldCreateUser=false, GoTrue returns 422 for unknown
  // emails. The form shows that error to the user directly — the
  // endpoint is already an enumeration oracle at the network layer,
  // so hiding the message in the UI would only hurt genuine
  // typo-ers without closing the leak.
  await page.route(SUPABASE_AUTH, async (route) => {
    const url = route.request().url();
    if (url.includes("/otp")) {
      // Matches what GoTrue actually returns for unknown emails when
      // shouldCreateUser=false — verified against the local stack.
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          code: 422,
          error_code: "otp_disabled",
          msg: "Signups not allowed for otp",
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, body: "{}" });
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill("stranger@example.test");
  await page.getByRole("button", { name: "Send sign-in link" }).click();

  await expect(
    page.getByText(/No account found for that email/),
  ).toBeVisible();
});
