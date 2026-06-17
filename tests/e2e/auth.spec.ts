import { expect, test } from "@playwright/test";

test("unauthenticated visit to / shows logged-out home page", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "The IS Web App" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join with an invite code" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Join a Connection Call" })).toBeVisible();
});

test("unauthenticated /api/hello returns 401", async ({ request }) => {
  const res = await request.get("/api/hello");
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthenticated" });
});

test("unauthenticated /api/version returns the deploy identity", async ({ request }) => {
  const res = await request.get("/api/version");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.id).toBe("string");
  expect(body.id.length).toBeGreaterThan(0);
  expect(body).toHaveProperty("appVersion");
  expect(body).toHaveProperty("urgentReleasedAt");
});
