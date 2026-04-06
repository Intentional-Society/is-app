import { Hono } from "hono";
import { db } from "./db";
import { sql } from "drizzle-orm";

const api = new Hono()
  .basePath("/api")
  .get("/hello", (c) => {
    return c.json({ message: "Hello from Intentional Society API" });
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
