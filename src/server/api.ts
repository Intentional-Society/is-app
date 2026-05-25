import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { log } from "next-axiom";

import { isRelationValue } from "@/lib/relation-value";

import { getAppSettings } from "./app-settings";
import { type ApiVariables, isAdmin, isUuid, requireAdmin, requireAuth } from "./auth-middleware";
import { clearAvatar, encodeAvatar, MAX_AVATAR_UPLOAD_BYTES, replaceAvatar } from "./avatars";
import { runButtondownSyncForServer, runFirstProfileSaveForServer } from "./buttondown-runner";
import { db } from "./db";
import { checkInvite, createInvite, getInvitesForCreator, revokeInvite, validateNote } from "./invites";
import {
  getProfileForMember,
  getProfileForSelf,
  getProfileForSelfWithProbe,
  listHiddenMembers,
  listMembers,
  markAgreementsSigned,
  markProgramsReviewed,
  markWebUpdated,
  parseEditableProfile,
  type ProfileForSelf,
  type ProfileReadProbe,
  setProfileHidden,
  toSlug,
  upsertProfile,
} from "./profiles";
import {
  addParticipant,
  createProgram,
  deleteProgram,
  getProgramBySlug,
  getProgramDetail,
  joinProgram,
  leaveProgram,
  listAllProgramsForAdmin,
  listPrograms,
  parseProgramCreate,
  parseProgramUpdate,
  removeParticipant,
  updateProgram,
} from "./programs";
import {
  createRelationHint,
  deleteRelationHint,
  getPersonalWeb,
  getRelationSuggestions,
  getRelationValue,
  listPendingHints,
  parseOptionalRelationValue,
  updateRelationValue,
} from "./relations";
import { profiles } from "./schema";
import { resetE2EUsers } from "./test-reset";

// Admin-only sub-router. requireAdmin runs after the main api's
// requireAuth (mounted via .route() below), so handlers here can
// assume both an authenticated user and isAdmin === true. New admin
// endpoints (e.g. api/admin/programs, api/admin/web) live here.
// "appsettings" leaves room for "usersettings" elsewhere later.
const adminRoutes = new Hono<{ Variables: ApiVariables }>()
  .use("*", requireAdmin)
  .get("/appsettings", async (c) => {
    const appSettings = await getAppSettings();
    return c.json({ appSettings });
  })
  .get("/hints", async (c) => {
    const hints = await listPendingHints();
    return c.json({ hints });
  })
  .get("/programs", async (c) => {
    const programsList = await listAllProgramsForAdmin();
    return c.json({ programs: programsList });
  })
  .post("/programs", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const parsed = parseProgramCreate(body);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);

    const result = await createProgram(parsed);
    if ("error" in result) return c.json({ error: result.error }, 409);
    return c.json({ program: result.program }, 201);
  })
  .get("/programs/:id", async (c) => {
    const result = await getProgramDetail(c.req.param("id"));
    if ("error" in result) return c.json({ error: result.error }, 404);
    return c.json({ program: result.program });
  })
  // validator-typed body: Hono's RPC inference rejects a `json` key on a
  // route that also has a path param unless the body is declared this
  // way (same reason as PUT /relations/value/:relateeId below).
  .patch(
    "/programs/:id",
    validator("json", (body, c) => {
      const parsed = parseProgramUpdate(body);
      if ("error" in parsed) return c.json({ error: parsed.error }, 400);
      return parsed;
    }),
    async (c) => {
      const result = await updateProgram(c.req.param("id"), c.req.valid("json"));
      if ("error" in result) {
        return c.json({ error: result.error }, result.error === "not_found" ? 404 : 409);
      }
      return c.json({ ok: true });
    },
  )
  .delete("/programs/:id", async (c) => {
    const result = await deleteProgram(c.req.param("id"));
    if ("error" in result) {
      return c.json({ error: result.error }, result.error === "not_found" ? 404 : 409);
    }
    return c.json({ ok: true });
  })
  .post(
    "/programs/:id/participants",
    validator("json", (body, c) => {
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return c.json({ error: "body must be a JSON object" }, 400);
      }
      const profileId = (body as Record<string, unknown>).profileId;
      if (typeof profileId !== "string" || !profileId) {
        return c.json({ error: "profileId is required" }, 400);
      }
      return { profileId };
    }),
    async (c) => {
      const result = await addParticipant(c.req.param("id"), c.req.valid("json").profileId);
      if ("error" in result) {
        return c.json({ error: result.error }, result.error === "already_member" ? 409 : 404);
      }
      return c.json({ ok: true });
    },
  )
  .delete("/programs/:id/participants/:profileId", async (c) => {
    const result = await removeParticipant(c.req.param("id"), c.req.param("profileId"));
    if ("error" in result) return c.json({ error: result.error }, 404);
    return c.json({ ok: true });
  })
  .get("/profiles/hidden", async (c) => {
    const members = await listHiddenMembers();
    return c.json({ members });
  })
  // hono/validator typed body — same path-param + JSON inference reason
  // as PATCH /programs/:id above.
  .patch(
    "/profiles/:id",
    validator("json", (body, c) => {
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return c.json({ error: "body must be a JSON object" }, 400);
      }
      const hidden = (body as Record<string, unknown>).hidden;
      if (typeof hidden !== "boolean") {
        return c.json({ error: "hidden must be a boolean" }, 400);
      }
      return { hidden };
    }),
    async (c) => {
      const profileId = c.req.param("id");
      if (!isUuid(profileId)) {
        return c.json({ error: "profileId must be a UUID" }, 400);
      }
      const { hidden } = c.req.valid("json");
      const result = await setProfileHidden({ profileId, hidden });
      if ("error" in result) return c.json({ error: result.error }, 404);
      return c.json({ ok: true });
    },
  )
  // Two admin-triggered Buttondown sync routes. The dry-run button
  // fires immediately and is safe to press anytime; the write button
  // is wrapped in a confirm step on the UI side. Both call the same
  // shared runner, distinguished only by `write` and by the
  // `acquired_by` string recorded on the lock.
  .post("/buttondown-sync/dry-run", async (c) => {
    const user = c.get("user");
    const result = await runButtondownSyncForServer({
      acquiredBy: `admin:${user.id}:dry-run`,
      write: false,
    });
    return c.json(result);
  })
  .post("/buttondown-sync/write", async (c) => {
    const user = c.get("user");
    const result = await runButtondownSyncForServer({
      acquiredBy: `admin:${user.id}:write`,
      write: true,
    });
    return c.json(result);
  });

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
    const debug = c.req.header("x-debug-timing") === "1";

    // #149 diagnostic: on debug-flagged requests, the read returns
    // MVCC + connection metadata in the same statement, logged below
    // so a failing welcome-flow trace can be cross-referenced with the
    // backend the read landed on. Production traffic stays on the
    // plain variant. Remove with the probe code once #149 is closed.
    const load = async (): Promise<{ profile: ProfileForSelf | null; probe: ProfileReadProbe | null }> => {
      if (debug) return getProfileForSelfWithProbe(user.id);
      return { profile: await getProfileForSelf(user.id), probe: null };
    };

    let { profile, probe } = await load();
    let stage: "initial" | "after-upsert" = "initial";
    if (!profile) {
      // Self-heal: profiles are normally inserted by /auth/callback
      // during sign-in. If that upsert failed but the session still
      // landed, the next authed request creates the row here.
      await upsertProfile(user);
      ({ profile, probe } = await load());
      stage = "after-upsert";
    }

    if (debug) {
      console.log(
        `[probe-149] route=me stage=${stage} user=${user.id} ` +
          `bio=${JSON.stringify(profile?.bio ?? null)} ` +
          `agreements=${profile?.lastSignedAgreements ? "set" : "null"} ` +
          `profile=${profile?.lastUpdatedProfile ? "set" : "null"} ` +
          `programs=${profile?.lastReviewedPrograms ? "set" : "null"} ` +
          `ctid=${probe?.ctid ?? ""} xmin=${probe?.xmin ?? ""} ` +
          `inRecovery=${probe?.inRecovery ?? ""} ` +
          `serverAddr=${probe?.serverAddr ?? ""} backendPid=${probe?.backendPid ?? ""}`,
      );
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

    // Inline first-profile-save detection: lastUpdatedProfile being
    // null right now (and a real update about to run) is "first
    // save", which fires the Buttondown inline hook below. See
    // docs/design-buttondown.md → "Inline hook on first profile save".
    const isFirstSave = !existing?.lastUpdatedProfile && Object.keys(parsed).length > 0;

    if (Object.keys(parsed).length > 0) {
      const update = {
        ...parsed,
        ...(parsed.displayName !== undefined ? { slug: parsed.displayName ? toSlug(parsed.displayName) : null } : {}),
        lastUpdatedProfile: sql`now()`,
      };
      try {
        await db.update(profiles).set(update).where(eq(profiles.id, user.id));
      } catch (err) {
        // Display name maps to a unique slug; a clash means another member
        // already uses this name. Surface it instead of a generic 500.
        const cause = (err as { cause?: { code?: string; constraint_name?: string } }).cause;
        if (cause?.code === "23505" && cause.constraint_name === "profiles_slug_unique") {
          return c.json({ error: "That display name is already taken. Please choose a different one." }, 409);
        }
        throw err;
      }
    }

    // Best-effort Buttondown inline hook. Failures inside the hook
    // are swallowed by the runner, so even a Buttondown outage
    // doesn't disturb the PUT /me response. The cron picks up any
    // miss. Soft-skips on BUTTONDOWN_API_KEY missing (dev / preview).
    if (isFirstSave && user.email) {
      await runFirstProfileSaveForServer({
        profileId: user.id,
        email: user.email,
        write: process.env.BUTTONDOWN_SYNC_WRITE === "1",
      });
    }

    const profile = await getProfileForSelf(user.id);
    return c.json({ id: user.id, email: user.email, profile });
  })
  .put("/me/last-updated-web", async (c) => {
    const user = c.get("user");
    await markWebUpdated(user.id);
    return c.json({ ok: true });
  })
  .put("/me/last-signed-agreements", async (c) => {
    const user = c.get("user");
    await markAgreementsSigned(user.id);
    return c.json({ ok: true });
  })
  .put("/me/last-reviewed-programs", async (c) => {
    const user = c.get("user");
    await markProgramsReviewed(user.id);
    return c.json({ ok: true });
  })
  .post("/me/avatar", async (c) => {
    const user = c.get("user");

    const form = await c.req.parseBody().catch(() => null);
    if (!form) {
      return c.json({ error: "invalid form body" }, 400);
    }
    const file = form.file;
    if (!(file instanceof File)) {
      return c.json({ error: "missing file field" }, 400);
    }
    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      return c.json({ error: "file too large" }, 400);
    }
    if (!file.type.startsWith("image/")) {
      return c.json({ error: "file must be an image" }, 400);
    }

    let webp: Buffer;
    try {
      webp = await encodeAvatar(Buffer.from(await file.arrayBuffer()));
    } catch {
      // sharp throws on bytes that do not decode as an image.
      return c.json({ error: "could not decode image" }, 400);
    }

    // Ensure a profile row exists before pointing it at the object —
    // the same self-heal guarantee GET/PUT /me carry.
    await upsertProfile(user);
    const avatarUrl = await replaceAvatar(user.id, webp);
    return c.json({ avatarUrl });
  })
  .delete("/me/avatar", async (c) => {
    const user = c.get("user");
    await clearAvatar(user.id);
    return c.json({ ok: true });
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

    // relationValue and hints are optional — the form omits them for
    // admin-issued invites and for inviters who decline the picker.
    const parsed = parseOptionalRelationValue(obj.relationValue);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }

    const result = await createInvite({
      createdBy: user.id,
      note: noteCheck,
      relationValue: parsed.value,
      hints: obj.hints as string[] | undefined,
    });

    if ("error" in result) {
      if (result.error === "too_many_active") {
        return c.json({ error: "too_many_active_invites", limit: result.limit }, 429);
      }
      if (result.error === "invalid_relation_value") {
        return c.json({ error: "relationValue must be an integer 1..4" }, 400);
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
    const adminFlag = await isAdmin(user.id);

    const result = await revokeInvite({ code, userId: user.id, isAdmin: adminFlag });
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
    const user = c.get("user");
    const includeHidden = await isAdmin(user.id);
    const members = await listMembers({ includeHidden });
    return c.json({ members });
  })
  .get("/members/:id", async (c) => {
    const user = c.get("user");
    const memberId = c.req.param("id");
    const includeHidden = await isAdmin(user.id);
    const profile = await getProfileForMember(memberId, { includeHidden });
    if (!profile) return c.json({ error: "not_found" }, 404);
    return c.json({ profile });
  })
  .get("/programs", async (c) => {
    const user = c.get("user");
    const programsList = await listPrograms(user.id);
    return c.json({ programs: programsList });
  })
  // Slug lives under a /by-slug/ prefix so it doesn't collide with the
  // UUID-keyed /:id/join and /:id/leave routes above.
  .get("/programs/by-slug/:slug", async (c) => {
    const user = c.get("user");
    const slug = c.req.param("slug");
    const result = await getProgramBySlug(slug, user.id);
    if ("error" in result) return c.json({ error: "not_found" }, 404);
    return c.json({ program: result.program });
  })
  .post("/programs/:id/join", async (c) => {
    const user = c.get("user");
    const programId = c.req.param("id");
    const result = await joinProgram(user.id, programId);
    if ("error" in result) {
      if (result.error === "not_found") {
        return c.json({ error: "not_found" }, 404);
      }
      if (result.error === "signups_closed") {
        return c.json({ error: "signups_closed" }, 409);
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
    const includeHidden = await isAdmin(user.id);
    const feed = await getRelationSuggestions(user.id, { includeHidden });
    return c.json(feed);
  })
  .get("/relations/subgraph", async (c) => {
    const user = c.get("user");
    // Defaults match the design: outgoing only, two hops. Toggles can
    // narrow or widen the view from the client.
    const includeOutgoing = c.req.query("out") !== "false";
    const includeIncoming = c.req.query("in") === "true";
    const hops = c.req.query("hops") === "1" ? 1 : 2;
    const includeHidden = await isAdmin(user.id);

    const subgraph = await getPersonalWeb({
      centerId: user.id,
      includeIncoming,
      includeOutgoing,
      hops,
      includeHidden,
    });
    return c.json(subgraph);
  })
  .get("/relations/value/:relateeId", async (c) => {
    const user = c.get("user");
    const relateeId = c.req.param("relateeId");
    if (!isUuid(relateeId)) return c.json({ error: "relateeId must be a UUID" }, 400);
    const value = await getRelationValue({ relatorId: user.id, relateeId });
    return c.json({ value });
  })
  // hono/validator typed body — without it, Hono's RPC inference on a
  // route with a path param rejects the `json` key on the typed call.
  .put(
    "/relations/value/:relateeId",
    validator("json", (body, c) => {
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return c.json({ error: "body must be a JSON object" }, 400);
      }
      const value = (body as Record<string, unknown>).value;
      if (!isRelationValue(value)) {
        return c.json({ error: "value must be an integer 1..4" }, 400);
      }
      return { value };
    }),
    async (c) => {
      const user = c.get("user");
      const relateeId = c.req.param("relateeId");
      if (!isUuid(relateeId)) {
        return c.json({ error: "relateeId must be a UUID" }, 400);
      }
      const { value } = c.req.valid("json");

      const result = await updateRelationValue({ relatorId: user.id, relateeId, value });
      if ("error" in result) {
        if (result.error === "self_relating") return c.json({ error: "self_relating" }, 400);
        if (result.error === "relatee_not_found") return c.json({ error: "not_found" }, 404);
      }
      return c.json({ ok: true });
    },
  )
  .post("/relations/hint", async (c) => {
    const user = c.get("user");
    // Generic 404 — same rationale as /api/admin/*: don't advertise
    // the admin surface to non-admins.
    if (!(await isAdmin(user.id))) {
      return c.json({ error: "not_found" }, 404);
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
    const { relatorId, relateeId } = body as Record<string, unknown>;
    if (!isUuid(relatorId) || !isUuid(relateeId)) {
      return c.json({ error: "relatorId and relateeId must be UUIDs" }, 400);
    }

    const result = await createRelationHint({ relatorId, relateeId, hintedBy: user.id });
    if ("error" in result) {
      if (result.error === "self_relating") return c.json({ error: "self_relating" }, 400);
      return c.json({ error: "not_found" }, 404);
    }
    return c.json(result, 201);
  })
  .delete("/relations/hint/:relatorId/:relateeId", async (c) => {
    const user = c.get("user");
    if (!(await isAdmin(user.id))) {
      return c.json({ error: "not_found" }, 404);
    }

    const relatorId = c.req.param("relatorId");
    const relateeId = c.req.param("relateeId");
    if (!isUuid(relatorId) || !isUuid(relateeId)) {
      return c.json({ error: "relatorId and relateeId must be UUIDs" }, 400);
    }

    const result = await deleteRelationHint({ relatorId, relateeId });
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
  })
  .route("/admin", adminRoutes);

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

// Vercel cron entrypoint. Vercel attaches `Authorization: Bearer
// $CRON_SECRET` when invoking scheduled crons; we reject anything
// else with 401. The write toggle is BUTTONDOWN_SYNC_WRITE=1 — the
// design's "Prod-only by construction" lock #4. Unset (the default)
// means dry-run; set means writes go through.
api.post("/cron/buttondown-sync", async (c) => {
  const provided = c.req.header("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || provided !== `Bearer ${cronSecret}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const result = await runButtondownSyncForServer({
    acquiredBy: `cron:${new Date().toISOString()}`,
    write: process.env.BUTTONDOWN_SYNC_WRITE === "1",
  });
  // Surface per-profile errors to Vercel's cron health view by
  // returning 500 when any profile failed. Vercel doesn't retry
  // failed crons, so this is signal-only: the cron dashboard lights
  // up and the existing Sentry capture in the runner pages someone.
  // Skipped runs (api-key-missing, lock-held) stay 200 since they
  // aren't failures from the cron's point of view.
  if (result.status === "ok" && result.summary.errors > 0) {
    return c.json(result, 500);
  }
  return c.json(result);
});

export type ApiRoutes = typeof api;
export default api;
