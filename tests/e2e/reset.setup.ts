import { type Page, test as setup } from "@playwright/test";

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

// Public routes whose first hit pays compile (local `next dev`) or
// function spin-up (CI Vercel) cost.
const WARMUP_ROUTES = ["/signin", "/", "/signup", "/forgot-password"];

// Per-attempt navigation windows. The first hit gets a generous window so a
// slow cold start still has room to respond — a cold function on a degraded CI
// network (#368) can exceed 30s. The retry is deliberately short: a function
// that's spinning up answers within a second or two, and a still-dead one
// should fail fast rather than burn another full window. `domcontentloaded` is
// the right signal — it fires once the route compiles and its HTML parses,
// which is the cost being paid forward; waiting for full `load` only adds
// fragility, since sub-resources warm on their own once the function is hot.
const WARMUP_FIRST_NAV_TIMEOUT_MS = 30_000;
const WARMUP_RETRY_NAV_TIMEOUT_MS = 8_000;
const WARMUP_ATTEMPTS = 2;

// Hard ceilings on each warm-up phase — the routes loop and the sign-in
// respectively. Once a phase's budget is spent it gives up loudly instead of
// grinding through every remaining retry. These — not the per-attempt windows
// — are what bound the worst case when the network browns out mid-run. A
// persistent brownout still recovers via CI's project-level `retries: 2`,
// which re-runs the whole setup test later.
const WARMUP_ROUTES_BUDGET_MS = 75_000;
const WARMUP_SIGN_IN_BUDGET_MS = 25_000;

// The setup test timeout sits above both phase budgets plus waitForURL slack
// (75s + 25s + ~12s), so the named budget/attempt errors below always fire
// before Playwright's opaque "Test timeout exceeded" message. Its 30s default
// is far too tight for a cold first hit, and would trip before the retry logic
// could run.
const WARMUP_TEST_TIMEOUT_MS = 120_000;

// Navigate to a route with one short retry, bounded by both its per-attempt
// window and the shared deadline. Returns once the document parses; throws a
// named error (which fails the setup project) once the attempts or the
// deadline are spent.
const warmRoute = async (page: Page, path: string, deadlineMs: number): Promise<void> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= WARMUP_ATTEMPTS; attempt++) {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) {
      throw new Error(`warm-up: routes budget spent before ${path} could warm`);
    }
    const perAttempt = attempt === 1 ? WARMUP_FIRST_NAV_TIMEOUT_MS : WARMUP_RETRY_NAV_TIMEOUT_MS;
    try {
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: Math.min(perAttempt, remaining) });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`warm-up: ${path} did not respond after ${WARMUP_ATTEMPTS} attempts: ${reason}`);
};

// Warm the page-serving path before any timed test runs. Paying cold-start
// cost here, in untimed setup, means the first real test no longer pays it
// inside signInAs's waitForURL budget — so TIMEOUT_MS can sit tight at 12s.
// The reset above only warms one API function; this warms the React/SSR page
// pipeline + the public routes, then signs in once to warm the authed landing
// the way every test reaches it. The sign-in is read-only (no completeWelcome),
// so the welcome spec still sees a fresh user.
//
// A warm-up that can't complete after its retries fails this setup project
// loudly: a cold/brownout run becomes a clear "warm-up: X did not respond"
// error rather than a confusing downstream first-test flake (#368). CI's
// project-level `retries: 2` still re-runs the whole warm-up, so only a
// persistent brownout fails the suite — a transient one recovers on retry.
setup("warm up the page-serving path", async ({ page }) => {
  setup.setTimeout(WARMUP_TEST_TIMEOUT_MS);

  const routesDeadline = Date.now() + WARMUP_ROUTES_BUDGET_MS;
  for (const path of WARMUP_ROUTES) {
    await warmRoute(page, path, routesDeadline);
  }

  // Warm the authed landing through a real sign-in, retrying on the same
  // cold/brownout terms. signInAs carries no explicit timeout on its goto or
  // form actions, and Playwright Test defaults navigationTimeout/actionTimeout
  // to 0 — so those operations would otherwise fall back to the whole remaining
  // test budget, letting one hung goto trip the opaque test timeout. Cap every
  // navigation/action to the remaining sign-in budget so this phase fails with
  // the named error below instead. (signInAs's waitForURL keeps its own 12s.)
  const signInDeadline = Date.now() + WARMUP_SIGN_IN_BUDGET_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= WARMUP_ATTEMPTS; attempt++) {
    const remaining = signInDeadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    page.setDefaultNavigationTimeout(remaining);
    page.setDefaultTimeout(remaining);
    try {
      await signInAs(page, "regular");
      return;
    } catch (error) {
      lastError = error;
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`warm-up: sign-in did not complete after ${WARMUP_ATTEMPTS} attempts: ${reason}`);
});
