import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { log } from "next-axiom";

import { type ApiVariables, requireAuth } from "./auth-middleware";
import { db } from "./db";
import { checkInvite, createInvite, getInvitesForCreator, revokeInvite, validateNote } from "./invites";
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
  createHint,
  deleteHint,
  getCandidates,
  getSubgraph,
  isAdmin,
  isRelationValue,
  isUuid,
  rateMember,
} from "./relations";
import { profiles } from "./schema";
import { resetE2EUsers } from "./test-reset";

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
        ...(parsed.displayName !== undefined ? { slug: parsed.displayName ? toSlug(parsed.displayName) : null } : {}),
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
    const obj = body as Record<string, unknown>;

    const noteCheck = validateNote(obj.note);
    if (typeof noteCheck !== "string") {
      return c.json({ error: noteCheck.error }, 400);
    }

    // creatorValue and hints are optional — the form omits them for
    // admin-issued invites and for inviters who decline the picker.
    const rawCreatorValue = obj.creatorValue;
    let creatorValue: 1 | 2 | 3 | 4 | null = null;
    if (rawCreatorValue !== undefined && rawCreatorValue !== null) {
      if (!isRelationValue(rawCreatorValue)) {
        return c.json({ error: "creatorValue must be an integer 1..4" }, 400);
      }
      creatorValue = rawCreatorValue;
    }

    const result = await createInvite({
      createdBy: user.id,
      note: noteCheck,
      creatorValue,
      hints: obj.hints as string[] | undefined,
    });

    if ("error" in result) {
      if (result.error === "too_many_active") {
        return c.json({ error: "too_many_active_invites", limit: result.limit }, 429);
      }
      if (result.error === "invalid_creator_value") {
        return c.json({ error: "creatorValue must be an integer 1..4" }, 400);
      }
      // invalid_hints — the reason names exactly what's wrong so the
      // form can call out the bad chip.
      return c.json({ error: "invalid_hints", reason: result.reason }, 400);
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

    const [row] = await db.select({ isAdmin: profiles.isAdmin }).from(profiles).where(eq(profiles.id, user.id));
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
  .get("/relations/candidates", async (c) => {
    const user = c.get("user");
    const feed = await getCandidates(user.id);
    return c.json(feed);
  })
  .get("/relations/subgraph", async (c) => {
    const user = c.get("user");
    // Defaults match the design: outgoing only, one hop. Toggles can
    // widen the view from the client.
    const includeOutgoing = c.req.query("out") !== "false";
    const includeIncoming = c.req.query("in") === "true";
    const hops = c.req.query("hops") === "2" ? 2 : 1;

    const subgraph = await getSubgraph({
      centerId: user.id,
      includeIncoming,
      includeOutgoing,
      hops,
    });
    return c.json(subgraph);
  })
  .put("/relations/:rateeId", async (c) => {
    const user = c.get("user");
    const rateeId = c.req.param("rateeId");
    if (!isUuid(rateeId)) {
      return c.json({ error: "rateeId must be a UUID" }, 400);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "body must be a JSON object" }, 400);
    }
    const value = (body as Record<string, unknown>).value;
    if (!isRelationValue(value)) {
      return c.json({ error: "value must be an integer 1..4" }, 400);
    }

    const result = await rateMember({ raterId: user.id, rateeId, value });
    if ("error" in result) {
      if (result.error === "self_rating") return c.json({ error: "self_rating" }, 400);
      if (result.error === "ratee_not_found") return c.json({ error: "not_found" }, 404);
    }
    return c.json({ ok: true });
  })
  .post("/relations/hint", async (c) => {
    const user = c.get("user");
    if (!(await isAdmin(user.id))) {
      return c.json({ error: "forbidden" }, 403);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "body must be a JSON object" }, 400);
    }
    const { raterId, rateeId } = body as Record<string, unknown>;
    if (!isUuid(raterId) || !isUuid(rateeId)) {
      return c.json({ error: "raterId and rateeId must be UUIDs" }, 400);
    }

    const result = await createHint({ raterId, rateeId, hintedBy: user.id });
    if ("error" in result) {
      if (result.error === "self_rating") return c.json({ error: "self_rating" }, 400);
      return c.json({ error: "not_found" }, 404);
    }
    return c.json(result, 201);
  })
  .delete("/relations/hint/:raterId/:rateeId", async (c) => {
    const user = c.get("user");
    if (!(await isAdmin(user.id))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const raterId = c.req.param("raterId");
    const rateeId = c.req.param("rateeId");
    if (!isUuid(raterId) || !isUuid(rateeId)) {
      return c.json({ error: "raterId and rateeId must be UUIDs" }, 400);
    }

    const result = await deleteHint({ raterId, rateeId });
    if ("error" in result) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ ok: true });
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
