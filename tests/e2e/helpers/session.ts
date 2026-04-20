import { type Page, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Shared password for every e2e-provisioned user. These accounts live only
// for the span of a single test and are deleted on teardown, so the value
// is immaterial — it just needs to be a valid string that satisfies the
// project's minimum-length policy.
const TEST_PASSWORD = "phase3-e2e-pw-a9f41";

const adminClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error(
      "e2e session helper requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY — " +
        "re-run `npm run setup` to regenerate .env.local.",
    );
  }
  return createClient(url, secret, { auth: { persistSession: false } });
};

export type TestUser = { id: string; email: string };

// Creates a confirmed auth.users row with a known password. The profile row
// is not inserted here — the app's /auth/callback upsert creates it on first
// sign-in, which keeps the helper agnostic of profile-schema changes.
export const createTestUser = async (email: string): Promise<TestUser> => {
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createTestUser failed: ${error?.message ?? "no user"}`);
  }
  return { id: data.user.id, email };
};

export const deleteTestUser = async (id: string): Promise<void> => {
  const client = adminClient();
  // /auth/callback (and /) self-heals a missing profile row, so by the
  // time the test finishes there is almost always a profiles row here.
  // It must go first because profiles.id FKs to auth.users with no
  // ON DELETE CASCADE. Row may not exist → `.eq` with no match is a no-op.
  const { error: profileError } = await client
    .from("profiles")
    .delete()
    .eq("id", id);
  if (profileError) {
    throw new Error(`deleteTestUser profile cleanup: ${profileError.message}`);
  }
  const { error } = await client.auth.admin.deleteUser(id);
  if (error) throw new Error(`deleteTestUser failed: ${error.message}`);
};

// Drives the real login form with a known password. Using the production
// sign-in path avoids a parallel "set the cookies directly" implementation
// that would drift from how sessions actually get established.
export const signIn = async (page: Page, email: string): Promise<void> => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (optional)").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Successful sign-in redirects off /login. /welcome is the common
  // landing spot for fresh users (bio is null).
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 10_000,
  });
};

// Convenience wrapper for the common case: "I need an authed session on
// page X." Returns the user id so the test can pass it to deleteTestUser
// in afterEach/afterAll.
export const signInAsNewUser = async (
  page: Page,
  emailPrefix = "e2e",
): Promise<TestUser> => {
  const email = `${emailPrefix}-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}@testfake.local`;
  const user = await createTestUser(email);
  await signIn(page, email);
  return user;
};

// Small assertion helper callers can use to confirm a successful sign-in
// without coupling to where the post-login redirect actually lands.
export const expectAuthed = async (page: Page): Promise<void> => {
  await expect(page).not.toHaveURL(/\/login/);
};

// Fresh users land on /welcome because bio is null; tests that need
// to exercise the post-welcome app surface (invite panel, etc.) use
// this to fill the minimum required fields and land on /. Bio is the
// sentinel `/` checks, so any non-empty string is enough.
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
