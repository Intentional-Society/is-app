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
  getProfileForMember,
  getProfileForSelf,
  listMembers,
  parseEditableProfile,
  toSlug,
  upsertProfile,
} from "./profiles";
import { joinProgram, leaveProgram, listPrograms } from "./programs";
import {
  assignMember,
  createProgram,
  deleteProgram,
  listAdminPrograms,
  listProgramMembers,
  removeMember,
  updateProgram,
} from "./programs-admin";
import {
  listAdminMembers,
  setAdminStatus,
} from "./members-admin";
import { profiles } from "./schema";
import { resetE2EUsers } from "./test-reset";

// Returns true if the given user id belongs to an admin profile.
// Used to gate every /api/admin/* route.
const checkAdmin = async (userId: string): Promise<boolean> => {
  const [row] = await db
    .select({ isAdmin: profiles.isAdmin })
    .from(profiles)
    .where(eq(profiles.id, userId));
  return row?.isAdmin ?? false;
};

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
      // Self-heal: profiles are normally inserted by /auth/callback
      // during sign-in. If that upsert failed but the session still
      // landed, the next authed request creates the row here.
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
      const update = {
        ...parsed,
        ...(parsed.displayName !== undefined
          ? { slug: parsed.displayName ? toSlug(parsed.displayName) : null }
          : {}),
      };
      await db.update(profiles).set(update).where(eq(profiles.id, user.id));
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
  .get("/members", async (c) => {
    const members = await listMembers();
    return c.json({ members });
  })
  .get("/members/:id", async (c) => {
    const memberId = c.req.param("id");
    const profile = await getProfileForMember(memberId);
    if (!profile) return c.json({ error: "not_found" }, 404);
    return c.json({ profile });
  })
  .get("/programs", async (c) => {
    const user = c.get("user");
    const programsList = await listPrograms(user.id);
    return c.json({ programs: programsList });
  })
  .post("/programs/:id/join", async (c) => {
    const user = c.get("user");
    const programId = c.req.param("id");
    const result = await joinProgram(user.id, programId);
    if ("error" in result) {
      if (result.error === "not_found") {
        return c.json({ error: "not_found" }, 404);
      }
      return c.json({ error: "already_joined" }, 409);
    }
    return c.json({ ok: true });
  })
  .post("/programs/:id/leave", async (c) => {
    const user = c.get("user");
    const programId = c.req.param("id");
    const result = await leaveProgram(user.id, programId);
    if ("error" in result) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ ok: true });
  })
  // ── Admin: programs ──────────────────────────────────────────────
  .get("/admin/programs", async (c) => {
    const user = c.get("user");
    if (!(await checkAdmin(user.id))) return c.json({ error: "forbidden" }, 403);
    const programsList = await listAdminPrograms();
    return c.json({ programs: programsList });
  })
  .post("/admin/programs", async (c) => {
    const user = c.get("user");
    if (!(await checkAdmin(user.id))) return c.json({ error: "forbidden" }, 403);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return c.json({ error: "body must be a JSON object" }, 400);
    const { name, description, slug, isActive } = body as Record<string, unknown>;
    if (typeof name !== "string") return c.json({ error: "name is required" }, 400);
    const result = await createProgram({
      name,
      description: typeof description === "string" ? description : null,
      slug: typeof slug === "string" ? slug : null,
      isActive: typeof isActive === "boolean" ? isActive : undefined,
      createdBy: user.id,
    });
    if ("error" in result) {
      if (result.error === "slug_taken") return c.json({ error: "slug_taken" }, 409);
      return c.json({ error: result.error }, 400);
    }
    return c.json(result, 201);
  })
  .put("/admin/programs/:id", async (c) => {
    const user = c.get("user");
    if (!(await checkAdmin(user.id))) return c.json({ error: "forbidden" }, 403);
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return c.json({ error: "body must be a JSON object" }, 400);
    const patch = body as Record<string, unknown>;
    const result = await updateProgram(id, {
      name: typeof patch.name === "string" ? patch.name : undefined,
      description:
        patch.description !== undefined
          ? typeof patch.description === "string"
            ? patch.description
            : null
          : undefined,
      slug: typeof patch.slug === "string" ? patch.slug : undefined,
      isActive: typeof patch.isActive === "boolean" ? patch.isActive : undefined,
    });
    if ("error" in result) {
      if (result.error === "not_found") return c.json({ error: "not_found" }, 404);
      if (result.error === "slug_taken") return c.json({ error: "slug_taken" }, 409);
      return c.json({ error: result.error }, 400);
    }
    return c.json({ ok: true });
  })
  .delete("/admin/programs/:id", async (c) => {
    const user = c.get("user");
    if (!(await checkAdmin(user.id))) return c.json({ error: "forbidden" }, 403);
    const id = c.req.param("id");
    const result = await deleteProgram(id);
    if ("error" in result) {
      if (result.error === "not_found") return c.json({ error: "not_found" }, 404);
      if (result.error === "has_members")
        return c.json({ error: "has_members", memberCount: result.memberCount }, 409);
    }
    return c.json({ ok: true });
  })
  .get("/admin/programs/:id/members", async (c) => {
    const user = c.get("user");
    if (!(await checkAdmin(user.id))) return c.json({ error: "forbidden" }, 403);
    const programId = c.req.param("id");
    const result = await listProgramMembers(programId);
    if ("error" in result) return c.json({ error: "not_found" }, 404);
    return c.json({ members: result });
  })
  .post("/admin/programs/:id/members", async (c) => {
    const user = c.get("user");
    if (!(await checkAdmin(user.id))) return c.json({ error: "forbidden" }, 403);
    const programId = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const { profileId } = body as Record<string, unknown>;
    if (typeof profileId !== "string")
      return c.json({ error: "profileId is required" }, 400);
    const result = await assignMember(programId, profileId);
    if ("error" in result) {
      if (result.error === "not_found") return c.json({ error: "not_found" }, 404);
      return c.json({ error: "already_assigned" }, 409);
    }
    return c.json({ ok: true }, 201);
  })
  .delete("/admin/programs/:id/members/:profileId", async (c) => {
    const user = c.get("user");
    if (!(await checkAdmin(user.id))) return c.json({ error: "forbidden" }, 403);
    const programId = c.req.param("id");
    const profileId = c.req.param("profileId");
    const result = await removeMember(programId, profileId);
    if ("error" in result) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  })
  // ── Admin: members ────────────────────────────────────────────────
  .get("/admin/members", async (c) => {
    const user = c.get("user");
    if (!(await checkAdmin(user.id))) return c.json({ error: "forbidden" }, 403);
    const members = await listAdminMembers();
    return c.json({ members });
  })
  .patch("/admin/members/:id/admin", async (c) => {
    const user = c.get("user");
    if (!(await checkAdmin(user.id))) return c.json({ error: "forbidden" }, 403);
    const targetId = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const { isAdmin: targetIsAdmin } = body as Record<string, unknown>;
    if (typeof targetIsAdmin !== "boolean")
      return c.json({ error: "isAdmin must be a boolean" }, 400);
    const result = await setAdminStatus(targetId, targetIsAdmin, user.id);
    if ("error" in result) {
      if (result.error === "not_found") return c.json({ error: "not_found" }, 404);
      if (result.error === "self_demotion") return c.json({ error: "self_demotion" }, 403);
      if (result.error === "last_admin") return c.json({ error: "last_admin" }, 409);
    }
    return c.json({ ok: true });
  })
  // ── Health ────────────────────────────────────────────────────────
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

// CI-only reset for the two seeded e2e users. Token header is the only
// gate — preview and prod share the same Supabase, so a VERCEL_ENV gate
// here would be theatre against a token that already mutates prod data.
// 404s on missing/wrong token to avoid advertising the endpoint.
api.post("/_test/reset", async (c) => {
  const token = c.req.header("x-ci-reset-token");
  if (!token || token !== process.env.CI_RESET_TOKEN) {
    return c.json({ error: "not_found" }, 404);
  }
  const result = await resetE2EUsers();
  return c.json(result);
});

export type ApiRoutes = typeof api;
export default api;
