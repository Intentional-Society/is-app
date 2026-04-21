import { type Page, expect } from "@playwright/test";

// Two long-lived test users seeded manually in prod Supabase. We sign
// in through the real /login form with a known password rather than
// minting a fresh user per test, which keeps the service-role key out
// of CI. Per-run state cleanup happens via POST /api/_test/reset in the
// Playwright setup project (see tests/e2e/reset.setup.ts).
export type TestRole = "regular" | "admin";

const EMAILS: Record<TestRole, string> = {
  regular: "e2e-regular@testfake.local",
  admin: "e2e-admin@testfake.local",
};

const passwordFor = (role: TestRole): string => {
  const envVar =
    role === "admin" ? "E2E_ADMIN_PASSWORD" : "E2E_REGULAR_PASSWORD";
  const value = process.env[envVar];
  if (!value) {
    throw new Error(
      `e2e session helper requires ${envVar} — set it in .env.local for ` +
        `local runs and as a GH Actions secret for CI.`,
    );
  }
  return value;
};

export type TestUser = { role: TestRole; email: string };

// Drives the real /login form with the seeded password. Using the
// production sign-in path avoids a parallel "set the cookies directly"
// implementation that would drift from how sessions actually get
// established.
export const signInAs = async (
  page: Page,
  role: TestRole,
): Promise<TestUser> => {
  const email = EMAILS[role];
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (optional)").fill(passwordFor(role));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 10_000,
  });
  return { role, email };
};

// Small assertion helper callers can use to confirm a successful sign-in
// without coupling to where the post-login redirect actually lands.
export const expectAuthed = async (page: Page): Promise<void> => {
  await expect(page).not.toHaveURL(/\/login/);
};

// After reset, bio is null and `/` redirects to `/welcome`. Tests that
// want to land on `/` (e.g. invite panel) call this to fill the form.
export const completeWelcome = async (
  page: Page,
  opts: { displayName?: string; bio?: string } = {},
): Promise<void> => {
  await page.waitForURL((url) => url.pathname === "/welcome", {
    timeout: 10_000,
  });
  await page.getByLabel("Display name").fill(opts.displayName ?? "E2E User");
  await page
    .getByLabel("Bio")
    .fill(opts.bio ?? "Short bio to clear the welcome redirect.");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 });
};

// Hits the CI-only /api/_test/reset endpoint to wipe profile fields and
// delete invites for both seeded users. The setup project calls this
// once at the top of each run; tests don't need to call it themselves.
export const resetSeededUsers = async (baseURL: string): Promise<void> => {
  const token = process.env.CI_RESET_TOKEN;
  if (!token) {
    throw new Error(
      "CI_RESET_TOKEN is required to run the e2e suite. Set it in " +
        ".env.local (must match the Vercel preview env var of the same name).",
    );
  }
  const res = await fetch(`${baseURL}/api/_test/reset`, {
    method: "POST",
    headers: { "x-ci-reset-token": token },
  });
  if (!res.ok) {
    throw new Error(
      `reset endpoint returned ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }
};
