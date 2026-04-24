import { test, expect } from "@playwright/test";

test("unauthenticated visit to / shows logged-out home page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Intentional Society" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Join with an invite code" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Join a Connection Call" }),
  ).toBeVisible();
});

test("unauthenticated /api/hello returns 401", async ({ request }) => {
  const res = await request.get("/api/hello");
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthenticated" });
});

test("unauthenticated /api/health returns 200", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
});
