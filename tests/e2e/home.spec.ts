import { test, expect } from "@playwright/test";

test("home page loads and displays API message", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  await expect(page.getByRole("heading", { name: "Intentional Society" })).toBeVisible();
  await expect(page.getByText("Hello from Intentional Society API")).toBeVisible();
  await expect(page.getByText("Database time:")).toBeVisible();
});
