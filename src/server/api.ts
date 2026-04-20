import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { log } from "next-axiom";

import { type ApiVariables, requireAuth } from "./auth-middleware";
import { db } from "./db";
import {
  checkInvite,
  createInvite,
  getInvitesForCreator,
  revokeInvite,
  validateNote,
} from "./invites";
import {
  getProfileForSelf,
  parseEditableProfile,
  upsertProfile,
} from "./profiles";
import { profiles } from "./schema";

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
  .put("/me", async (c) => {
    const user = c.get("user");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }

    const parsed = parseEditableProfile(body);
    if ("error" in parsed) {
      return c.json({ error: parsed.error }, 400);
    }

    // Ensure a row exists before updating — same self-heal guarantee
    // GET /me has, since a client can PUT /me before ever calling GET.
    const existing = await getProfileForSelf(user.id);
    if (!existing) {
      await upsertProfile(user);
    }

    if (Object.keys(parsed).length > 0) {
      await db.update(profiles).set(parsed).where(eq(profiles.id, user.id));
    }

    const profile = await getProfileForSelf(user.id);
    return c.json({ id: user.id, email: user.email, profile });
  })
  .post("/invites", async (c) => {
    const user = c.get("user");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "body must be a JSON object" }, 400);
    }

    const noteCheck = validateNote((body as Record<string, unknown>).note);
    if (typeof noteCheck !== "string") {
      return c.json({ error: noteCheck.error }, 400);
    }

    const result = await createInvite({ createdBy: user.id, note: noteCheck });
    if ("error" in result) {
      return c.json(
        { error: "too_many_active_invites", limit: result.limit },
        429,
      );
    }
    return c.json(result, 201);
  })
  .get("/invites/mine", async (c) => {
    const user = c.get("user");
    const invites = await getInvitesForCreator(user.id);
    return c.json({ invites });
  })
  .post("/invites/:code/revoke", async (c) => {
    const user = c.get("user");
    const code = c.req.param("code");

    const [row] = await db
      .select({ isAdmin: profiles.isAdmin })
      .from(profiles)
      .where(eq(profiles.id, user.id));
    const isAdmin = row?.isAdmin ?? false;

    const result = await revokeInvite({ code, userId: user.id, isAdmin });
    if ("error" in result) {
      if (result.error === "not_found") {
        return c.json({ error: "not_found" }, 404);
      }
      if (result.error === "forbidden") {
        return c.json({ error: "forbidden" }, 403);
      }
      if (result.error === "already_redeemed") {
        return c.json({ error: "already_redeemed" }, 409);
      }
    }
    return c.json({ ok: true });
  })
  .get("/invites/:code/check", async (c) => {
    const code = c.req.param("code");
    const result = await checkInvite(code);
    if (result.valid) {
      return c.json({ valid: true, note: result.note });
    }
    return c.json({ valid: false, reason: result.reason });
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
