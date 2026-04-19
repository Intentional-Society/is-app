import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { log } from "next-axiom";

import { type ApiVariables, requireAuth } from "./auth-middleware";
import { db } from "./db";
import { getProfileForSelf, upsertProfile } from "./profiles";

const api = new Hono<{ Variables: ApiVariables }>()
  .basePath("/api")
  .use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    log.info("api request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration,
    });
  })
  .use("*", requireAuth)
  .get("/hello", (c) => {
    return c.json({ message: "Hello from Intentional Society API" });
  })
  .get("/me", async (c) => {
    const user = c.get("user");

    let profile = await getProfileForSelf(user.id);
    if (!profile) {
      // Self-heal: 1d's callback can leave a session without a profile
      // row if the upsert failed there. The next authed request repairs.
      await upsertProfile(user);
      profile = await getProfileForSelf(user.id);
    }

    return c.json({ id: user.id, email: user.email, profile });
  })
  .get("/health", async (c) => {
    const result = await db.execute(sql`SELECT now() AS server_time`);
    return c.json({
      status: "ok",
      database: {
        connected: true,
        serverTime: result[0].server_time,
      },
    });
  });

export type ApiRoutes = typeof api;
export default api;
