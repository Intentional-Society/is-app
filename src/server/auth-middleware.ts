import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import type { MiddlewareHandler } from "hono";

export type ApiVariables = { user: User };

// Routes that bypass auth. Keep this tight — the regression guard in
// auth-middleware.test.ts asserts nothing else is public.
export const PUBLIC_PATHS = new Set<string>(["/api/health"]);

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
    if (PUBLIC_PATHS.has(c.req.path)) {
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
