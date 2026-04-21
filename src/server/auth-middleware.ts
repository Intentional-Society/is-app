import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import type { MiddlewareHandler } from "hono";

export type ApiVariables = { user: User };

// Routes that bypass auth. Keep this tight — the regression guard in
// auth-middleware.test.ts asserts nothing else is public.
// Strings are matched exactly; RegExps are tested against c.req.path.
export const PUBLIC_PATHS: readonly (string | RegExp)[] = [
  "/api/health",
  // Prospective members check an invite code before being asked for an
  // email, so this must be reachable without a session.
  /^\/api\/invites\/[^/]+\/check$/,
  // CI-only test-reset endpoint. The endpoint itself is gated by
  // VERCEL_ENV + a shared-secret header — the CI token is the auth here,
  // not a Supabase session.
  "/api/_test/reset",
];

const isPublicPath = (path: string): boolean =>
  PUBLIC_PATHS.some((p) => (typeof p === "string" ? p === path : p.test(path)));

const parseCookieHeader = (
  header: string | null,
): { name: string; value: string }[] => {
  if (!header) return [];
  return header.split(";").map((pair) => {
    const [name, ...rest] = pair.trim().split("=");
    return { name, value: rest.join("=") };
  });
};

export const requireAuth: MiddlewareHandler<{ Variables: ApiVariables }> =
  async (c, next) => {
    if (isPublicPath(c.req.path)) {
      return next();
    }

    const cookies = parseCookieHeader(c.req.raw.headers.get("cookie"));

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
      {
        cookies: {
          getAll: () => cookies,
          // Root middleware (src/middleware.ts) is responsible for
          // token refresh; this layer only reads.
          setAll: () => {},
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return c.json({ error: "unauthenticated" }, 401);
    }

    c.set("user", user);
    return next();
  };
