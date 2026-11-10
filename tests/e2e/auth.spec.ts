import { readdirSync } from "node:fs";
import path from "node:path";

import { expect, test } from "./helpers/fixtures";

// What a signed-out visitor gets: the public landing page, a 401 from the
// API, and a redirect to /signin from every members-only page.

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

// The pages a signed-out visitor may load. Every other page under
// src/app is members-only. /colors is the dev-only palette page, a 404
// in a production build.
const PUBLIC_PAGES = ["/", "/signin", "/signup", "/forgot-password", "/auth/reset-password", "/colors"];

// Every page route in the app, read from src/app: one per page.tsx, with
// a stand-in for each dynamic segment. Route handlers (api/, the auth
// callback, sign-out) have no page.tsx and aren't pages.
const pageRoutes = (dir = path.join(__dirname, "..", "..", "src", "app"), route = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      // A (group) folder adds no URL segment.
      if (entry.name.startsWith("(")) return pageRoutes(path.join(dir, entry.name), route);
      const segment = entry.name.startsWith("[") ? "e2e-no-such-entry" : entry.name;
      return pageRoutes(path.join(dir, entry.name), `${route}/${segment}`);
    }
    return entry.name === "page.tsx" ? [route || "/"] : [];
  });

// A page is members-only by calling requireUser(), one page at a time, so
// a new page that forgets the call would be served to anyone. Reading the
// routes from disk means that page fails here without being listed.
test("every members-only page sends a signed-out visitor to /signin", async ({ request, baseURL }) => {
  const membersOnly = pageRoutes().filter((route) => !PUBLIC_PAGES.includes(route));
  // The scan found the app, not an empty directory.
  expect(membersOnly).toContain("/me");
  expect(membersOnly).toContain("/admin");

  const served = await Promise.all(
    membersOnly.map(async (route) => {
      const res = await request.get(route, { maxRedirects: 0 });
      const location = res.headers().location;
      return { route, status: res.status(), to: location ? new URL(location, baseURL).pathname : null };
    }),
  );

  expect(served).toEqual(membersOnly.map((route) => ({ route, status: 307, to: "/signin" })));
});
