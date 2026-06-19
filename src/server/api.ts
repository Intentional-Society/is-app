import type { User } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { log } from "next-axiom";

import { appVersion, urgentReleasedAt } from "@/lib/changelog";
import { isRelationValue } from "@/lib/relation-value";
import { toSlug } from "@/lib/slug";

import { getAppSettings } from "./app-settings";
import { type ApiVariables, isAdmin, isUuid, requireAdmin, requireAuth } from "./auth-middleware";
import { clearAvatar, encodeAvatar, MAX_AVATAR_UPLOAD_BYTES, replaceAvatar } from "./avatars";
import {
  runButtondownSyncForServer,
  runFirstProfileSaveForServer,
  runProfileResyncForServer,
} from "./buttondown-runner";
import { db } from "./db";
import {
  checkInvite,
  createInvite,
  deleteInvite,
  getInvitesForCreator,
  listAllInvitesForAdmin,
  revokeInvite,
  validateNote,
} from "./invites";
import { listActiveMemberEmails, listMembersAdmin, setAdminStatus } from "./members-admin";
import {
  deactivateProfile,
  getProfileForMember,
  getProfileForSelf,
  getProfileForSelfWithProbe,
  isSlugUniqueViolation,
  listCurrentIntentions,
  listHiddenMembers,
  listMembers,
  markAgreementsSigned,
  markProgramsReviewed,
  markWebUpdated,
  type ProfileForSelf,
  type ProfileReadProbe,
  parseEditableProfile,
  reactivateProfile,
  removePassword,
  setPasswordFlag,
  setProfileHidden,
  syncDisplayNameToAuthMetadata,
  upsertProfile,
  withSlugPermutation,
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
  deleteRelationValue,
  getRelationSuggestions,
  getRelationValue,
  listPendingHints,
  parseOptionalRelationValue,
  updateRelationValue,
} from "./relations";
import { getProfileMiniMap } from "./relations-mini-map";
import { getPersonalWeb } from "./relations-personal";
import { profiles } from "./schema";
import { listSigninsAdmin } from "./signins-admin";
import { getSystemMetrics } from "./system-metrics";
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
    const targetProfileId = c.req.param("profileId");
    const result = await removeParticipant(c.req.param("id"), targetProfileId);
    if ("error" in result) return c.json({ error: result.error }, 404);
    // Best-effort inline resync so the removed program's tag drops
    // off the subscriber within this request instead of waiting for
    // the next cron. The cron is the safety net.
    await runProfileResyncForServer({
      profileId: targetProfileId,
      reason: "admin-remove-participant",
      write: process.env.BUTTONDOWN_SYNC_WRITE === "1",
    });
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
      // Admin clicked once; absorb brief contention rather than
      // surfacing a "skipped" surprise. Same budget as inline resync.
      lockRetries: 2,
      lockRetryDelayMs: 500,
    });
    return c.json(result);
  })
  .post("/buttondown-sync/write", async (c) => {
    const user = c.get("user");
    const result = await runButtondownSyncForServer({
      acquiredBy: `admin:${user.id}:write`,
      write: true,
      lockRetries: 2,
      lockRetryDelayMs: 500,
    });
    return c.json(result);
  })
  .get("/members", async (c) => {
    const members = await listMembersAdmin();
    return c.json({ members });
  })
  .get("/signins", async (c) => {
    const signins = await listSigninsAdmin();
    return c.json({ signins });
  })
  .get("/member-emails", async (c) => {
    const emails = await listActiveMemberEmails();
    return c.json({ emails });
  })
  .patch(
    "/members/:id/admin",
    validator("json", (body, c) => {
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return c.json({ error: "body must be a JSON object" }, 400);
      }
      const isAdmin = (body as Record<string, unknown>).isAdmin;
      if (typeof isAdmin !== "boolean") {
        return c.json({ error: "isAdmin must be a boolean" }, 400);
      }
      return { isAdmin };
    }),
    async (c) => {
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "id must be a UUID" }, 400);
      const user = c.get("user");
      const result = await setAdminStatus(id, c.req.valid("json").isAdmin, user.id);
      if ("error" in result) {
        if (result.error === "self_demotion") return c.json({ error: "self_demotion" }, 403);
        if (result.error === "last_admin") return c.json({ error: "last_admin" }, 409);
        return c.json({ error: "not_found" }, 404);
      }
      return c.json({ ok: true });
    },
  )
  .get("/invites", async (c) => {
    const invitesList = await listAllInvitesForAdmin();
    return c.json({ invites: invitesList });
  })
  // Hard delete (not revoke), per the /admin/invites page. invite_hints
  // cascade, so the row and its hints go together.
  .delete("/invites/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "id must be a UUID" }, 400);
    const result = await deleteInvite(id);
    if ("error" in result) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
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
      // The auth UUID (pseudonymous, never the email) so Axiom can count
      // distinct people and per-path adoption. Unset on public/401 paths
      // — this middleware logs after requireAuth runs but also fires for
      // requests it never authenticates. See docs/doc-axiom.md.
      userId: (c.get("user") as User | undefined)?.id ?? null,
    });
    // next-axiom buffers events in-process and sends on a 1s throttle;
    // a frozen serverless instance silently loses any unsent batch
    // (whole cron runs went missing from Axiom this way — see
    // docs/doc-axiom.md). waitUntil keeps the instance alive until the
    // batch is delivered without delaying the response. Outside Vercel
    // it no-ops and the long-lived process delivers on the throttle.
    waitUntil(log.flush());
  })
  .use("*", requireAuth)
  .get("/hello", (c) => {
    return c.json({ message: "Hello from Intentional Society API" });
  })
  // Community figures for the /metrics page. Member-readable (mounted
  // under requireAuth above) — getSystemMetrics omits anything naming a
  // not-yet-member, so no admin gate is needed.
  .get("/metrics", async (c) => {
    const metrics = await getSystemMetrics();
    return c.json({ metrics });
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
      // message "probe-149" is the feature label; split on fields.route
      // to compare the /me read against the /home and /reset probes.
      log.debug("probe-149", {
        route: "me",
        stage,
        userId: user.id,
        bio: profile?.bio ?? null,
        agreements: Boolean(profile?.lastSignedAgreements),
        profile: Boolean(profile?.lastUpdatedProfile),
        programs: Boolean(profile?.lastReviewedPrograms),
        ctid: probe?.ctid ?? null,
        xmin: probe?.xmin ?? null,
        inRecovery: probe?.inRecovery ?? null,
        serverAddr: probe?.serverAddr ?? null,
        backendPid: probe?.backendPid ?? null,
      });
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
    // Re-read after the upsert so the slug-backfill check below sees
    // any slug the upsert just derived from auth metadata.
    let existing = await getProfileForSelf(user.id);
    if (!existing) {
      await upsertProfile(user);
      existing = await getProfileForSelf(user.id);
    }

    // Inline first-profile-save detection: lastUpdatedProfile being
    // null right now (and a real update about to run) is "first
    // save", which fires the Buttondown inline hook below. See
    // docs/design-buttondown.md → "Inline hook on first profile save".
    const isFirstSave = !existing?.lastUpdatedProfile && Object.keys(parsed).length > 0;

    if (Object.keys(parsed).length > 0) {
      // Slugs are stable (#188): a displayName edit never rewrites an
      // existing slug, so old profile links keep working. The slug
      // changes through exactly two paths — an explicit `slug` in the
      // body (the settings page), or a one-time derivation from
      // displayName while the slug is still null (first profile save).
      const backfillSlug =
        parsed.slug === undefined && !existing?.slug && parsed.displayName ? toSlug(parsed.displayName) || null : null;
      const update = {
        ...parsed,
        ...(backfillSlug ? { slug: backfillSlug } : {}),
        // Stamp the intention's own timestamp only when its text actually
        // changes — the /intentions cloud orders "freshest on top" by it,
        // so an unrelated profile edit must not float a stale intention up.
        ...(parsed.currentIntention !== undefined && parsed.currentIntention !== (existing?.currentIntention ?? null)
          ? { intentionUpdatedAt: sql`now()` }
          : {}),
        lastUpdatedProfile: sql`now()`,
      };
      try {
        if (backfillSlug) {
          // A derived-slug clash must not block the profile save —
          // display names may repeat. The helper permutes (-2, -3, …)
          // so a name twin still gets a readable URL.
          await withSlugPermutation(backfillSlug, (slug) =>
            db
              .update(profiles)
              .set({ ...update, slug })
              .where(eq(profiles.id, user.id)),
          );
        } else {
          await db.update(profiles).set(update).where(eq(profiles.id, user.id));
        }
      } catch (err) {
        // An explicitly chosen slug that clashes is the member's to
        // fix; surface it instead of a generic 500.
        if (isSlugUniqueViolation(err) && parsed.slug !== undefined) {
          return c.json({ error: "That profile URL is already taken. Please choose a different one." }, 409);
        }
        throw err;
      }

      // Mirror a displayName edit into auth.users.user_metadata so auth
      // emails greet the member by their current name. Runs only after the
      // DB write commits, so a slug clash (409 above) can't desync the two.
      if (parsed.displayName !== undefined) {
        await syncDisplayNameToAuthMetadata(user.id, parsed.displayName, user.user_metadata ?? {});
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
  .post("/me/deactivate", async (c) => {
    const user = c.get("user");
    const result = await deactivateProfile(user.id);
    if ("error" in result) return c.json({ error: "profile not found" }, 404);
    return c.json({ ok: true });
  })
  .post("/me/reactivate", async (c) => {
    const user = c.get("user");
    const result = await reactivateProfile(user.id);
    if ("error" in result) return c.json({ error: "profile not found" }, 404);
    return c.json({ ok: true });
  })
  .post("/me/password-flag", async (c) => {
    const user = c.get("user");
    await setPasswordFlag(user.id, true);
    return c.json({ ok: true });
  })
  .delete("/me/password", async (c) => {
    const user = c.get("user");
    const result = await removePassword(user.id);
    if ("error" in result) return c.json({ error: result.error }, 500);
    return c.json({ ok: true });
  })
  .post("/me/avatar", async (c) => {
    const user = c.get("user");

    const form = await c.req.parseBody().catch(() => null);
    if (!form) {
      return c.json(
        {
          error:
            "We couldn't read that upload. Try once more — if it keeps failing, please let us know with the Give Feedback link in the menu.",
        },
        400,
      );
    }
    const file = form.file;
    if (!(file instanceof File)) {
      return c.json({ error: "No image was attached. Please choose a photo." }, 400);
    }
    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      return c.json({ error: "That image is too large. Please choose a smaller photo." }, 400);
    }
    if (!file.type.startsWith("image/")) {
      return c.json({ error: "That file isn't an image. Please choose a JPEG, PNG, or WebP." }, 400);
    }

    let webp: Buffer;
    try {
      webp = await encodeAvatar(Buffer.from(await file.arrayBuffer()));
    } catch {
      // sharp throws on bytes that do not decode as an image.
      return c.json({ error: "We couldn't read that image. Please try a JPEG or PNG." }, 400);
    }

    // A browser that can't encode WebP via canvas.toBlob falls back to
    // JPEG (the client switches formats; see avatar-uploader.tsx), so a
    // non-WebP arrival is that fallback firing. Log the rate to size who's
    // affected — Safari/iOS historically — and to catch a regression.
    // The received content type is the signal; see docs/doc-axiom.md.
    if (!file.type.includes("webp")) {
      log.info("avatar webp fallback", { userId: user.id, receivedType: file.type, bytes: file.size });
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
  .get("/intentions", async (c) => {
    const user = c.get("user");
    const includeHidden = await isAdmin(user.id);
    const intentions = await listCurrentIntentions({ includeHidden });
    return c.json({ intentions });
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
    // Best-effort inline resync; the cron is the safety net.
    await runProfileResyncForServer({
      profileId: user.id,
      reason: "join-program",
      write: process.env.BUTTONDOWN_SYNC_WRITE === "1",
    });
    return c.json({ ok: true });
  })
  .post("/programs/:id/leave", async (c) => {
    const user = c.get("user");
    const programId = c.req.param("id");
    const result = await leaveProgram(user.id, programId);
    if ("error" in result) {
      return c.json({ error: "not_found" }, 404);
    }
    await runProfileResyncForServer({
      profileId: user.id,
      reason: "leave-program",
      write: process.env.BUTTONDOWN_SYNC_WRITE === "1",
    });
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
  // Read-only mini-map for a member's profile page: the profile member, their
  // strong connections, and the caller's shortest path back to them. Mirrors
  // /relations/subgraph's admin → includeHidden rule.
  .get("/relations/mini-map/:profileId", async (c) => {
    const user = c.get("user");
    const profileId = c.req.param("profileId");
    if (!isUuid(profileId)) return c.json({ error: "profileId must be a UUID" }, 400);
    const includeHidden = await isAdmin(user.id);
    const miniMap = await getProfileMiniMap({ viewerId: user.id, profileId, includeHidden });
    return c.json(miniMap);
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
  // Remove the caller's own confirmed relationship with :relateeId — the "No
  // Relationship" control. relatorId is fixed to the authed user, so a
  // member can only delete their own outgoing edge. Idempotent: deleting
  // an absent relation still returns 200, so a stale UI never errors.
  .delete("/relations/value/:relateeId", async (c) => {
    const user = c.get("user");
    const relateeId = c.req.param("relateeId");
    if (!isUuid(relateeId)) {
      return c.json({ error: "relateeId must be a UUID" }, 400);
    }
    await deleteRelationValue({ relatorId: user.id, relateeId });
    return c.json({ ok: true });
  })
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
  // Public deploy-identity probe for the update banner
  // (docs/strategy-deployment.md). Unauthenticated so an idle tab whose
  // session has lapsed can still detect a newer deployment — the tabs
  // most likely to be running stale code. The client polls this with a
  // plain fetch, which Skew Protection does not pin, so it resolves to
  // current production and reports that deployment's id, not the caller's.
  .get("/version", (c) => {
    return c.json({
      id: process.env.VERCEL_DEPLOYMENT_ID ?? "dev",
      appVersion,
      urgentReleasedAt,
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
// GET because Vercel cron invokes endpoints via HTTP GET.
api.get("/cron/buttondown-sync", async (c) => {
  const provided = c.req.header("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || provided !== `Bearer ${cronSecret}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const result = await runButtondownSyncForServer({
    acquiredBy: `cron:${new Date().toISOString()}`,
    write: process.env.BUTTONDOWN_SYNC_WRITE === "1",
    // Inline resyncs hold the lock for ~1s each. A daily cron can
    // realistically collide with one. Skipping costs 24h of drift, so
    // wait up to 10s for the lock — well under Vercel's 300s function
    // timeout and far longer than any inline run. If contention
    // persists past 10s, the prior cron is genuinely stuck and the
    // existing Sentry warning surfaces it.
    lockRetries: 20,
    lockRetryDelayMs: 500,
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
