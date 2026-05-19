import { expect, test } from "@playwright/test";

import { completeWelcome, resetSeededUsers, signInAs, TIMEOUT_MS } from "./helpers/session";

// Smoke coverage of /myweb's wiring: page loads, the WebBuilder
// suggestion feed renders, the Done button toggles into View mode and
// the Edit button toggles back. The rich rating-flow path is left to
// PR 4's e2e once the welcome tour seeds enough relational data to
// drive a populated suggestion feed.

test.describe.configure({ mode: "serial" });

test.describe("/myweb — tour pre-dismissed", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("myweb.spec.ts: baseURL is not configured");
    await resetSeededUsers(baseURL);
    // The welcome tour fires whenever lastUpdatedWeb is null; tests in
    // this block exercise the page wiring, not the tour, so pre-dismiss
    // via the same sessionStorage key MyWeb checks on mount.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("isweb-welcome-tour-dismissed", "1");
    });
  });

  test("/myweb loads, Done flips into View, Edit flips back", async ({ page }) => {
    await signInAs(page, "regular");
    // Distinct bio per completeWelcome caller — see the #149 probe.
    await completeWelcome(page, { bio: "e2e bio · myweb.spec · tour-pre-dismissed" });

    await page.getByRole("link", { name: "My web" }).click();
    await page.waitForURL((u) => u.pathname === "/myweb", { timeout: TIMEOUT_MS });
    await expect(page.getByRole("heading", { name: "My web" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Add people to your relational web" })).toBeVisible();
    // exact: true — a substring match on "Done" / "Edit" also catches
    // member cards (role=button), e.g. "Lyn McDonell" contains "done".
    const doneButton = page.getByRole("button", { name: "Done", exact: true });
    await expect(doneButton).toBeVisible();

    await doneButton.click();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Add people to your relational web" })).toBeHidden();

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Add people to your relational web" })).toBeVisible();
  });
});

test.describe("/myweb — first-time welcome tour", () => {
  test.beforeEach(async ({ baseURL }) => {
    if (!baseURL) throw new Error("myweb.spec.ts: baseURL is not configured");
    await resetSeededUsers(baseURL);
    // No addInitScript: this block wants the tour to fire on mount.
  });

  test("tour appears for a first-time visitor and can be skipped", async ({ page }) => {
    await signInAs(page, "regular");
    // Distinct bio per completeWelcome caller — see the #149 probe.
    await completeWelcome(page, { bio: "e2e bio · myweb.spec · first-time-tour" });
    await page.getByRole("link", { name: "My web" }).click();
    await page.waitForURL((u) => u.pathname === "/myweb", { timeout: TIMEOUT_MS });

    await expect(page.getByText("Welcome to your relational web")).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /^Skip$/ }).click();
    await expect(page.getByText("Welcome to your relational web")).toBeHidden();
  });
});
