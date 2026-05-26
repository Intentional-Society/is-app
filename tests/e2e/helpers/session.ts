import { expect, type Page } from "@playwright/test";

// Two long-lived test users seeded manually in prod Supabase. We sign
// in through the real /signin form with a known password rather than
// minting a fresh user per test, which keeps the service-role key out
// of CI. Per-run state cleanup happens via POST /api/_test/reset in the
// Playwright setup project (see tests/e2e/reset.setup.ts).
export type TestRole = "regular" | "admin";

// Shared wait budget for page.waitForURL across the suite. Bumped from
// 10s after Vercel preview cold-starts made 10s flaky; revisit once we
// chase down the underlying first-request slowness.
export const TIMEOUT_MS = 20_000;

const EMAILS: Record<TestRole, string> = {
  regular: "e2e-regular@testfake.local",
  admin: "e2e-admin@testfake.local",
};

const passwordFor = (role: TestRole): string => {
  const envVar = role === "admin" ? "E2E_ADMIN_PASSWORD" : "E2E_REGULAR_PASSWORD";
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

// Drives the real /signin form with the seeded password. Using the
// production sign-in path avoids a parallel "set the cookies directly"
// implementation that would drift from how sessions actually get
// established.
export const signInAs = async (page: Page, role: TestRole): Promise<TestUser> => {
  const email = EMAILS[role];
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  // Signin form defaults to email-link mode; switch to password mode
  // before the seeded password field is rendered.
  await page.getByRole("button", { name: "Sign in with password instead" }).click();
  await page.getByLabel("Password", { exact: true }).fill(passwordFor(role));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), {
    timeout: TIMEOUT_MS,
  });
  return { role, email };
};

// Small assertion helper callers can use to confirm a successful sign-in
// without coupling to where the post-sign-in redirect actually lands.
export const expectAuthed = async (page: Page): Promise<void> => {
  await expect(page).not.toHaveURL(/\/signin/);
};

// After reset, a seeded user has no welcome markers, so `/` redirects
// into the multi-step welcome flow. This walks all three steps —
// agreements, profile, programs — and leaves the page on `/`. Tests
// that just need to get past onboarding call it; the profile-step opts
// (displayName/bio) still flow through, so the #149 probe keeps its
// distinct-bio-per-caller invariant.
export const completeWelcome = async (page: Page, opts: { displayName?: string; bio?: string } = {}): Promise<void> => {
  // Step 1 — agreements.
  await page.waitForURL((url) => url.pathname === "/welcome/agreements", { timeout: TIMEOUT_MS });
  await page.getByRole("button", { name: "I agree" }).click();

  // Step 2 — profile.
  await page.waitForURL((url) => url.pathname === "/welcome/profile", { timeout: TIMEOUT_MS });
  await page.getByLabel("Display name").fill(opts.displayName ?? "E2E User");
  await page.getByLabel("Bio").fill(opts.bio ?? "Short bio to clear the welcome redirect.");
  await page.getByRole("button", { name: "Save" }).click();

  // Step 3 — programs.
  await page.waitForURL((url) => url.pathname === "/welcome/programs", { timeout: TIMEOUT_MS });
  await page.getByRole("button", { name: "Done", exact: true }).click();

  // Onboarding complete: the flow hands off to /myweb. Return to `/` so
  // callers start from the home page.
  await page.waitForURL((url) => url.pathname === "/myweb", { timeout: TIMEOUT_MS });
  await page.goto("/");
  await page.waitForURL((url) => url.pathname === "/", { timeout: TIMEOUT_MS });
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
    throw new Error(`reset endpoint returned ${res.status}: ${await res.text().catch(() => "")}`);
  }

  // #149 probe: the endpoint reads every seeded profile back after its
  // reset transaction commits, with physical-tuple (ctid/xmin) and
  // connection (replica/search_path) diagnostics. A reset is clean when
  // every existing profile row has bio null. Two things fail loud here
  // — in beforeEach, instead of 20s later at a /welcome timeout: a row
  // whose bio survived the reset (the #149 symptom), or duplicate
  // tuples for one id. A seeded user with no profile row at all (0 rows
  // — no test has signed in as them yet this run) is fine, not flagged.
  // The dump shows the surviving bio string (its value names the test
  // that wrote it, since each completeWelcome caller passes a distinct
  // bio), the tuple identity, and whether the read ran on a replica.
  type ResetProbeRow = {
    ctid: string;
    xmin: string;
    bio: string | null;
    updatedAt: string | null;
    inRecovery: boolean;
    searchPath: string;
    serverAddr: string | null;
    backendPid: number;
  };
  const body = (await res.json()) as {
    reset: number;
    updatedIds: string[];
    profiles: { id: string; email: string; rows: ResetProbeRow[] }[];
  };
  const anomalies = body.profiles.filter((p) => p.rows.length > 1 || p.rows.some((r) => r.bio !== null));
  if (anomalies.length > 0) {
    const detail = anomalies
      .map((p) => `  ${p.email} (${p.id}): ${p.rows.length} row(s) → ${JSON.stringify(p.rows)}`)
      .join("\n");
    throw new Error(
      `reset endpoint: seeded profile not clean after reset — see #149\n` +
        `updatedIds=${JSON.stringify(body.updatedIds)}\n${detail}`,
    );
  }
};
