import { test as setup } from "@playwright/test";

import { resetSeededUsers, signInAs } from "./helpers/session";

// Runs once at the top of every e2e run. Wipes profile fields and
// deletes invites for the two seeded users so the welcome spec's
// bio-null-redirect assertion holds and the invites specs start
// with an empty invite list.
setup("reset seeded test users", async ({ baseURL }) => {
  if (!baseURL) {
    throw new Error("reset.setup.ts: baseURL is not configured");
  }
  await resetSeededUsers(baseURL);
});

// Warm the page-serving path before any timed test runs. Local e2e hits
// `next dev`, which compiles each route on first request; CI's first hit
// cold-starts the Vercel functions. Either way the *first* test used to
// pay that cost inside signInAs's waitForURL budget and flake (always the
// alphabetically-first spec). Paying it here, in untimed setup, makes the
// first real test no longer special — and lets TIMEOUT_MS sit tight at 12s.
//
// The reset above only warms one API function; this warms the React/SSR
// page pipeline + the public routes, then signs in once to warm the authed
// landing the way every test reaches it. The sign-in is read-only (no
// completeWelcome), so the welcome spec still sees a fresh user. Best-effort
// throughout: a warm-up miss must never turn into a suite failure.
setup("warm up the page-serving path", async ({ page }) => {
  for (const path of ["/signin", "/", "/signup", "/forgot-password"]) {
    await page.goto(path).catch(() => {});
  }
  await signInAs(page, "regular").catch(() => {});
});
