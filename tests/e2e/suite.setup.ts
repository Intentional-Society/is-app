import { type Browser, type BrowserContext, type Page, test as setup } from "@playwright/test";

import { ACCOUNTS, type AccountKey, sessionAccounts, storageStatePath, workerAccounts } from "./helpers/accounts";
import { resetAccounts, signInThroughForm } from "./helpers/session";

// Runs once at the top of every e2e run, before any spec: resets the
// seeded accounts, warms the page-serving path, and signs each account
// in through the real form, saving its browser state for the specs to
// start from (helpers/fixtures.ts). suite.teardown.ts signs the
// accounts out again at the end.

// The second test builds on the first.
setup.describe.configure({ mode: "serial" });

// The sign-in below types the seeded passwords, and a trace records
// every call's arguments and every request body.
setup.use({ trace: "off" });

// Wipes profile fields and deletes invites for every seeded account, so
// the run starts from fresh accounts whatever the last run left behind.
setup("reset the seeded accounts", async ({ baseURL }) => {
  if (!baseURL) {
    throw new Error("suite.setup.ts: baseURL is not configured");
  }
  await resetAccounts(baseURL);
});

// Public routes whose first hit pays compile (local `next dev`) or
// function spin-up (CI Vercel) cost.
const WARMUP_PUBLIC_ROUTES = ["/signin", "/", "/signup", "/forgot-password", "/auth/reset-password"];

// Signed-in routes the specs visit. Each first hit pays the same cold
// cost, and an unwarmed one pays it inside a spec's 12s waitForURL
// budget — the agreements → profile hop of the welcome flow blew that
// budget this way (#437). Warmed GET-only — see the phase-3 note.
const WARMUP_MEMBER_ROUTES = [
  "/",
  "/welcome",
  "/welcome/agreements",
  "/welcome/profile",
  "/welcome/programs",
  "/me",
  "/myweb",
  "/invites",
  "/about",
  "/members",
  "/intentions",
];
const WARMUP_ADMIN_ROUTES = ["/admin", "/admin/programs"];

// Per-attempt navigation windows. The first hit gets a generous window so a
// slow cold start still has room to respond — a cold function on a degraded CI
// network (#368) can exceed 30s. The retry is short: a function
// that's spinning up answers within a second or two, and a still-dead one
// should fail fast rather than burn another full window. `domcontentloaded` is
// the right signal — it fires once the route compiles and its HTML parses,
// which is the cost being paid forward; waiting for full `load` only adds
// fragility, since sub-resources warm on their own once the function is hot.
const WARMUP_FIRST_NAV_TIMEOUT_MS = 30_000;
const WARMUP_RETRY_NAV_TIMEOUT_MS = 8_000;
const WARMUP_ATTEMPTS = 2;

// Hard ceilings on each warm-up phase — the public routes, the sign-ins,
// and the signed-in routes respectively. Once a phase's budget is spent it
// gives up loudly instead of grinding through every remaining retry.
// These — not the per-attempt windows — are what bound the worst case when the
// network browns out mid-run. A persistent brownout still recovers via CI's
// project-level `retries: 2`, which re-runs the whole setup test later.
const WARMUP_ROUTES_BUDGET_MS = 75_000;
const WARMUP_SIGN_IN_BUDGET_MS = 25_000;
const WARMUP_AUTHED_BUDGET_MS = 45_000;

// The setup test timeout sits above all three phase budgets plus waitForURL
// slack (75s + 25s + 45s + ~12s), so the named budget/attempt errors below
// always fire before Playwright's opaque "Test timeout exceeded" message. Its
// 30s default is far too tight for a cold first hit, and would trip before the
// retry logic could run.
const WARMUP_TEST_TIMEOUT_MS = 165_000;

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

// Warms a set of routes side by side, each in its own tab of `context`,
// under one shared budget.
const warmRoutes = async (context: BrowserContext, paths: string[], budgetMs: number): Promise<void> => {
  const deadline = Date.now() + budgetMs;
  await Promise.all(
    paths.map(async (path) => {
      const page = await context.newPage();
      try {
        await warmRoute(page, path, deadline);
      } finally {
        await page.close();
      }
    }),
  );
};

// Signs one account in through the real form and saves its browser state,
// retrying on the same cold/brownout terms as the routes. signInThroughForm
// carries no explicit timeout on its goto or form actions, and Playwright
// Test defaults navigationTimeout/actionTimeout to 0 — so those operations
// would otherwise fall back to the whole remaining test budget, letting one
// hung goto trip the opaque test timeout. Capping every navigation/action to
// the remaining sign-in budget makes this fail with the named error below
// instead. (signInThroughForm's waitForURL keeps its own 12s.)
const signIn = async (browser: Browser, key: AccountKey, deadlineMs: number): Promise<BrowserContext> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= WARMUP_ATTEMPTS; attempt++) {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) {
      break;
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(remaining);
    page.setDefaultTimeout(remaining);
    try {
      await signInThroughForm(page, key);
      await context.storageState({ path: storageStatePath(key) });
      await page.close();
      return context;
    } catch (error) {
      lastError = error;
      await context.close();
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `warm-up: sign-in as ${ACCOUNTS[key].email} did not complete after ${WARMUP_ATTEMPTS} attempts: ${reason}`,
  );
};

// Warm the page-serving path before any timed test runs, and sign in.
// Paying cold-start cost here, in untimed setup, means no spec pays it
// inside a waitForURL budget — so TIMEOUT_MS can sit tight at 12s. The reset
// above only warms one API function; this warms the React/SSR page pipeline +
// public routes, signs each account in the way a member does, then warms the
// signed-in routes the specs visit. Every step is read-only — the routes are
// GET-only (no welcome marker stamped), so the accounts stay fresh.
//
// A warm-up that can't complete after its retries fails this setup project
// loudly: a cold/brownout run becomes a clear "warm-up: X did not respond"
// error rather than a confusing downstream first-test flake (#368, #437). CI's
// project-level `retries: 2` still re-runs the whole warm-up, so only a
// persistent brownout fails the suite — a transient one recovers on retry.
setup("warm up the page-serving path and sign in", async ({ browser }) => {
  setup.setTimeout(WARMUP_TEST_TIMEOUT_MS);

  // Phase 1 — public routes.
  const anonymous = await browser.newContext();
  await warmRoutes(anonymous, WARMUP_PUBLIC_ROUTES, WARMUP_ROUTES_BUDGET_MS);
  await anonymous.close();

  // Phase 2 — one real sign-in per account, saved for the specs.
  const signInDeadline = Date.now() + WARMUP_SIGN_IN_BUDGET_MS;
  const contexts = await Promise.all(
    sessionAccounts().map(async (key) => [key, await signIn(browser, key, signInDeadline)] as const),
  );
  const sessions = new Map(contexts);

  // Phase 3 — signed-in routes. Each GET compiles the route's module — the
  // same module the in-app RSC navigation reuses. (The API routes ride the
  // Hono catch-all, already warmed by the reset above; and a GET stamps
  // nothing, so the accounts stay fresh.)
  const member = sessions.get(workerAccounts()[0]) as BrowserContext;
  const admin = sessions.get("admin") as BrowserContext;
  await Promise.all([
    warmRoutes(member, WARMUP_MEMBER_ROUTES, WARMUP_AUTHED_BUDGET_MS),
    warmRoutes(admin, WARMUP_ADMIN_ROUTES, WARMUP_AUTHED_BUDGET_MS),
  ]);

  await Promise.all([...sessions.values()].map((context) => context.close()));
});
