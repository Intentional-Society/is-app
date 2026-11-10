import type { Locator, Page } from "@playwright/test";

import type { E2EResetState, ResetResult } from "../../../src/server/test-reset";
import { ACCOUNTS, type Account, type AccountKey } from "./accounts";

// Shared wait budget for page.waitForURL across the suite. The setup
// project warms the page-serving path (suite.setup.ts), so no test pays
// cold-start compile / function spin-up inside this budget. With the
// server warm, every navigation is a warm-route hit, so 12s is a
// comfortable margin that also fails fast on a genuinely stuck
// navigation.
export const TIMEOUT_MS = 12_000;

const passwordFor = (account: Account): string => {
  const value = process.env[account.passwordEnvVar];
  if (!value) {
    throw new Error(
      `e2e sign-in requires ${account.passwordEnvVar} — set it in .env.local for ` +
        `local runs and as a GH Actions secret for CI.`,
    );
  }
  return value;
};

// Types a secret into a field without the value reaching the report.
// Playwright titles a fill step `Fill "<value>"`, and CI uploads the HTML
// report as an artifact of a public repo, so a password must never go
// through locator.fill. This sets the value the way fill does — the
// native setter, then the input and change events React listens for —
// from inside the page, where the step is titled just "Evaluate".
//
// A trace would still record the argument, so every file that calls
// this also sets `trace: "off"`.
const fillSecret = async (field: Locator, secret: string): Promise<void> => {
  await field.evaluate((element, value) => {
    const input = element as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, secret);
};

// Drives the real /signin form with the seeded password. The setup
// project calls this once per account and saves the resulting browser
// state; tests start from that state instead of signing in again (see
// fixtures.ts). Using the production sign-in path avoids a parallel
// "set the cookies directly" implementation that would drift from how
// sessions actually get established.
export const signInThroughForm = async (page: Page, key: AccountKey): Promise<void> => {
  const account = ACCOUNTS[key];
  await page.goto("/signin");
  await page.getByLabel("Email").fill(account.email);
  // Signin form defaults to email-link mode; switch to password mode
  // before the seeded password field is rendered.
  await page.getByRole("button", { name: "Sign in with password instead" }).click();
  await fillSecret(page.getByLabel("Password", { exact: true }), passwordFor(account));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), {
    timeout: TIMEOUT_MS,
  });
};

// Hits the CI-only /api/_test/reset endpoint, which deletes the
// account's invites and rewrites its profile to `state` (fresh or
// onboarded; see E2EResetState). With no `account` it resets every
// seeded account. The setup project calls it once for all accounts; the
// `user` fixture calls it for the worker's own account before each
// signed-in test.
export const resetAccounts = async (
  baseURL: string,
  options: { account?: AccountKey; state?: E2EResetState } = {},
): Promise<void> => {
  const token = process.env.CI_RESET_TOKEN;
  if (!token) {
    throw new Error(
      "CI_RESET_TOKEN is required to run the e2e suite. Set it in " +
        ".env.local (must match the Vercel preview env var of the same name).",
    );
  }
  const res = await fetch(`${baseURL}/api/_test/reset`, {
    method: "POST",
    headers: { "x-ci-reset-token": token, "content-type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    throw new Error(`reset endpoint returned ${res.status}: ${await res.text().catch(() => "")}`);
  }

  // Reset tripwire (kept from the #149 investigation): the endpoint
  // reads each profile back after its reset writes commit, with
  // physical-tuple (ctid/xmin) and connection (replica/search_path)
  // diagnostics. A reset is clean when the row read back is the row the
  // reset wrote: the bio it set (null for fresh) and the welcome step
  // that state implies. Anything else fails loud here, before the test
  // starts, instead of seconds later at a confusing redirect: a row the
  // write didn't reach (the #149 write-loss/clobber symptom) or
  // duplicate tuples for one id. A fresh account with no profile row at
  // all (it has never signed in on this database) is fine, not flagged.
  // The dump shows the surviving row, its tuple identity, and whether
  // the read ran on a replica.
  const body = (await res.json()) as ResetResult;
  const anomalies = body.accounts.filter((a) => {
    if (a.rows.length > 1) return true;
    if (a.rows.length === 0) return a.state !== "fresh";
    const expectedStep = a.state === "fresh" ? "agreements" : null;
    return a.rows[0].bio !== a.expectedBio || a.welcomeStep !== expectedStep;
  });
  if (anomalies.length > 0) {
    const detail = anomalies
      .map(
        (a) =>
          `  ${a.email} (${a.id}) → wanted ${a.state}, welcomeStep=${a.welcomeStep}, ` +
          `${a.rows.length} row(s): ${JSON.stringify(a.rows)}`,
      )
      .join("\n");
    throw new Error(
      `reset endpoint: seeded profile not in the requested state after reset — see #149\n` +
        `updatedIds=${JSON.stringify(body.updatedIds)}\n${detail}`,
    );
  }
  const wanted = options.account ? [options.account] : (Object.keys(ACCOUNTS) as AccountKey[]);
  const missing = wanted.filter((key) => !body.accounts.some((a) => a.account === key));
  if (missing.length > 0) {
    throw new Error(
      `reset endpoint: no auth user for ${missing.map((key) => ACCOUNTS[key].email).join(", ")} — ` +
        `seed the e2e accounts (docs/doc-supabase.md).`,
    );
  }
};
