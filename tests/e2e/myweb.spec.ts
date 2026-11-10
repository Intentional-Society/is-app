import { expect, test } from "./helpers/fixtures";
import { TIMEOUT_MS } from "./helpers/session";

// Smoke coverage of /myweb's wiring: page loads, the WebBuilder
// suggestion feed renders, the Done button toggles into View mode and
// the Edit button toggles back. The rich relating-flow path is left to
// PR 4's e2e once the welcome tour seeds enough relational data to
// drive a populated suggestion feed.

test.use({ user: "member" });

test.describe("/myweb — tour pre-dismissed", () => {
  test.beforeEach(async ({ page }) => {
    // The welcome tour fires whenever lastUpdatedWeb is null; tests in
    // this block exercise the page wiring, not the tour, so pre-dismiss
    // via the same sessionStorage key MyWeb checks on mount. Registered
    // before the first page load: the link click below is a client-side
    // navigation, which runs no init script.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("isweb-welcome-tour-dismissed", "1");
    });
  });

  test("/myweb loads, Done flips into View, Edit flips back", async ({ page }) => {
    await page.goto("/");
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

// No addInitScript in this block: it wants the tour to fire on mount.
// The onboarded reset leaves lastUpdatedWeb null, as the welcome flow
// does, so the member counts as a first-time visitor.
test.describe("/myweb — first-time welcome tour", () => {
  test("tour appears for a first-time visitor and can be skipped", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "My web" }).click();
    await page.waitForURL((u) => u.pathname === "/myweb", { timeout: TIMEOUT_MS });

    await expect(page.getByText("Mapping your relational web")).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /^Dismiss tour$/ }).click();
    await expect(page.getByText("Mapping your relational web")).toBeHidden();
  });

  test("first Done shows the farewell capstone over the home icon, then stays on /myweb", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "My web" }).click();
    await page.waitForURL((u) => u.pathname === "/myweb", { timeout: TIMEOUT_MS });

    // Farewell eligibility is decided at mount, so dismissing the
    // welcome tour mid-way still earns the goodbye.
    await expect(page.getByText("Mapping your relational web")).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /^Dismiss tour$/ }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await expect(page.getByText("You're all set!")).toBeVisible();
    // The title row hides while the capstone spotlights the top strip —
    // "My web" and the breadcrumb sit inside it and would compete with
    // the icons — and returns on dismissal.
    await expect(page.getByRole("heading", { name: "My web" })).toBeHidden();
    await page.getByRole("button", { name: "Thanks!" }).click();
    await expect(page.getByText("You're all set!")).toBeHidden();
    await expect(page.getByRole("heading", { name: "My web" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/myweb");
  });
});
