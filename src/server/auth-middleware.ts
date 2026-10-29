import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";

import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import { decodeUser, SUPABASE_USER_HEADER } from "@/lib/supabase/server-user";

import { db } from "./db";
import { profiles } from "./schema";
import { E2E_EMAILS } from "./test-reset";

export type ApiVariables = { user: User };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// UUID predicate, used at API boundaries that take an id from a path
// or body. Lives in the auth/middleware layer because it's part of
// the request-shape validators that gate every route, not anything
// domain-specific.
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

// Resolves the admin flag for a given user id with one DB roundtrip.
// Routes that need an admin gate call this; the alternative would be
// to attach the flag to the auth-middleware context alongside `user`,
// which is a fair next step once enough routes care.
export const isAdmin = async (userId: string): Promise<boolean> => {
  const [row] = await db.select({ isAdmin: profiles.isAdmin }).from(profiles).where(eq(profiles.id, userId));
  return row?.isAdmin ?? false;
};

// The seeded e2e accounts (E2E_EMAILS) sign in with passwords held as
// GitHub Actions secrets, and e2e.yml runs unreviewed branch code
// (Dependabot bumps, feature-branch previews) with those secrets in its
// environment. e2e-admin is a real prod admin, so its admin powers are
// capped to the reads tests/e2e/admin.spec.ts loads; every other admin
// route answers it as it would a non-admin.
export const E2E_ADMIN_READS: readonly string[] = [
  "/api/admin/appsettings",
  "/api/admin/hints",
  "/api/admin/profiles/hidden",
  "/api/admin/programs",
];

// Keyed on the `e2e_account` app_metadata flag, which only the service
// role can write. The email match alone is bypassable: with "Confirm
// email" off, Supabase commits an email change on the new address's
// click alone, so a password holder can move the account off its
// testfake.local email. The email match covers an account not yet flagged.
export const isE2EAccount = (user: User): boolean =>
  user.app_metadata?.e2e_account === true || (E2E_EMAILS as readonly string[]).includes(user.email ?? "");

// Admin-only gate for the /api/admin/* sub-router. Runs after
// requireAuth, so c.get("user") is always populated. Returns 404
// rather than 403 so the surface isn't advertised to non-admins —
// matches the /admin page's notFound() behavior.
export const requireAdmin: MiddlewareHandler<{ Variables: ApiVariables }> = async (c, next) => {
  const user = c.get("user");
  if (isE2EAccount(user) && !(c.req.method === "GET" && E2E_ADMIN_READS.includes(c.req.path))) {
    return c.json({ error: "not_found" }, 404);
  }
  if (!(await isAdmin(user.id))) {
    return c.json({ error: "not_found" }, 404);
  }
  return next();
};

// Routes that bypass auth. Keep this tight — the regression guard in
// auth-middleware.test.ts asserts nothing else is public.
// Strings are matched exactly; RegExps are tested against c.req.path.
export const PUBLIC_PATHS: readonly (string | RegExp)[] = [
  // Deploy-identity probe polled by the update banner; unauthenticated
  // so an idle or signed-out tab can still detect a new version.
  "/api/version",
  // Prospective members check an invite code before being asked for an
  // email, so this must be reachable without a session.
  /^\/api\/invites\/[^/]+\/check$/,
  // CI-only test-reset endpoint. Gated by a shared-secret header — the
  // CI token is the auth here, not a Supabase session.
  "/api/_test/reset",
  // Vercel cron endpoint. Gated by the CRON_SECRET bearer check that
  // Vercel attaches when invoking scheduled crons; no Supabase
  // session is present.
  "/api/cron/buttondown-sync",
];

const isPublicPath = (path: string): boolean =>
  PUBLIC_PATHS.some((p) => (typeof p === "string" ? p === path : p.test(path)));

const parseCookieHeader = (header: string | null): { name: string; value: string }[] => {
  if (!header) return [];
  return header.split(";").map((pair) => {
    const [name, ...rest] = pair.trim().split("=");
    return { name, value: rest.join("=") };
  });
};

export const requireAuth: MiddlewareHandler<{ Variables: ApiVariables }> = async (c, next) => {
  if (isPublicPath(c.req.path)) {
    return next();
  }

  // Fast path: the root proxy authed once on the inbound request and
  // attached the User in SUPABASE_USER_HEADER. Trust it — the proxy
  // strips any forged inbound value before writing the validated one.
  let user = decodeUser(c.req.header(SUPABASE_USER_HEADER));

  if (!user) {
    // Fallback for callers that bypass the proxy: functional tests
    // dispatching through app.request(), and the rare proxy-excluded
    // path that still routes through requireAuth.
    const cookies = parseCookieHeader(c.req.raw.headers.get("cookie"));

    const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
      cookies: {
        getAll: () => cookies,
        setAll: () => {},
      },
    });

    const {
      data: { user: fetched },
    } = await supabase.auth.getUser();
    user = fetched;
  }

  if (!user) {
    return c.json({ error: "unauthenticated" }, 401);
  }

  c.set("user", user);
  return next();
};
