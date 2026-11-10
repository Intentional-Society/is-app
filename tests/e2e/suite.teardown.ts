import { expect, test as teardown } from "@playwright/test";

import { sessionAccounts, storageStatePath } from "./helpers/accounts";
import { resetAccounts, TIMEOUT_MS } from "./helpers/session";

// Runs once at the end of every e2e run, after every spec: signs each
// account out through the menu. The app's sign-out ends every session
// of the account (Supabase's default `global` scope), including the one
// the specs share, so it can't run while they do. Running it last also
// means nothing the run created outlives it: the session tokens saved
// under playwright/.auth are dead, and the reset each test starts with
// deletes the account's invites, whose codes the report shows in the
// signup spec's steps.

for (const key of sessionAccounts()) {
  teardown(`sign-out ends every ${key} session`, async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error("suite.teardown.ts: baseURL is not configured");
    // A mid-onboarding member is redirected to /welcome, which renders
    // no menu; onboard the account so the menu is reachable from /.
    await resetAccounts(baseURL, { account: key, state: "onboarded" });

    const context = await browser.newContext({ storageState: storageStatePath(key) });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL((url) => url.pathname === "/signin", { timeout: TIMEOUT_MS });

    // Confirm the session really is gone.
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await context.close();

    // A second browser still holding the saved cookies is signed out
    // too: the session was ended on the server, not just forgotten by
    // the browser that clicked.
    const other = await browser.newContext({ storageState: storageStatePath(key) });
    const otherPage = await other.newPage();
    await otherPage.goto("/");
    await expect(otherPage.getByRole("button", { name: "Sign in" })).toBeVisible();
    await other.close();
  });
}
