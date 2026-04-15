import { test, expect } from "@playwright/test";

test("home page loads and displays database time", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  await expect(page.getByRole("heading", { name: "Intentional Society" })).toBeVisible();
  await expect(page.getByText("Database time:")).toBeVisible();
});
