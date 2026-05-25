// Shared runner that wires the Buttondown sync core to production
// concerns: env-keyed real client, the concurrency lock, structured
// logging, and Sentry alerting for unsubscribed members.
//
// Two entry points share this runner: the cron endpoint (one fixed
// `acquiredBy` per scheduled run) and the admin "Sync now" buttons
// (one per click, identified by the admin's profile id).

import * as Sentry from "@sentry/nextjs";
import { log } from "next-axiom";

import { createButtondownClient } from "./buttondown";
import {
  runButtondownSync,
  runFirstProfileSaveSync,
  type SyncLogEvent,
  type SyncRunSummary,
  type UnsubscribeAlert,
} from "./buttondown-sync";
import { acquireLock, releaseLock } from "./sync-locks";

const LOCK_NAME = "buttondown";

export type RunButtondownSyncOptions = {
  // Identifier for this run, recorded on the lock and in every log
  // event. Cron uses "cron:<iso-timestamp>"; admin uses
  // "admin:<profileId>:<dry-run|write>"; per-profile resync uses
  // "resync:<reason>:<profileId>".
  acquiredBy: string;
  // Whether this run is allowed to write. The client itself enforces
  // the gate; the runner threads it through and uses it in logs.
  write: boolean;
  // Narrow the reconciler to a specific set of profiles. Used by the
  // per-profile resync paths so an inline hook doesn't walk the whole
  // audience. Omit for the daily broad sweep.
  scopeProfileIds?: string[];
  // If the lock is held by another run on the first try, sleep this
  // long and retry — once per retry. Inline resyncs use this to hide
  // brief contention (the typical run is sub-second); the cron and
  // admin buttons leave it 0 so a held lock surfaces immediately.
  lockRetries?: number;
  lockRetryDelayMs?: number;
};

export type RunResult =
  | { status: "ok"; summary: SyncRunSummary }
  | { status: "skipped"; reason: "api_key_missing" | "lock_held" };

const isSyncLogEvent = (event: SyncLogEvent): event is SyncLogEvent => event !== undefined;

export const runButtondownSyncForServer = async (options: RunButtondownSyncOptions): Promise<RunResult> => {
  const runId = options.acquiredBy;

  // Lock #2 from the design doc's "Prod-only by construction" — the
  // sync is a no-op in any environment without the API key. This is
  // the only gate the inline first-save path will share with this
  // path, so it's intentionally a soft skip rather than an error.
  if (!process.env.BUTTONDOWN_API_KEY) {
    log.warn("buttondown sync", { action: "skipped-api-key-missing", acquiredBy: runId });
    return { status: "skipped", reason: "api_key_missing" };
  }

  // Track attempts and total wait so Axiom can answer "how often
  // does retry save us?" Per-attempt outcome stays implicit — only
  // the final ack (lock-acquired) or final fail (skipped-lock-held)
  // is logged, both carrying the same attempts/waitedMs fields.
  const lockRetries = options.lockRetries ?? 0;
  const lockRetryDelayMs = options.lockRetryDelayMs ?? 0;
  let attempts = 1;
  let waitedMs = 0;
  let got = await acquireLock(LOCK_NAME, runId);
  while (!got && attempts <= lockRetries) {
    await new Promise((resolve) => setTimeout(resolve, lockRetryDelayMs));
    waitedMs += lockRetryDelayMs;
    attempts++;
    got = await acquireLock(LOCK_NAME, runId);
  }
  if (!got) {
    log.warn("buttondown sync", {
      action: "skipped-lock-held",
      acquiredBy: runId,
      attempts,
      waitedMs,
    });
    // A held lock that survives every retry means the previous
    // invocation is still running well past its expected window —
    // that's a real signal, not just noise. Send it to Sentry so it
    // pages; the fingerprint stays stable so an operator sees one
    // issue per ongoing overlap, not one per cron.
    Sentry.captureMessage("buttondown.sync_lock_held", {
      level: "warning",
      tags: { feature: "buttondown-sync", action: "skipped-lock-held", acquiredBy: runId },
      extra: { attempts, waitedMs },
    });
    return { status: "skipped", reason: "lock_held" };
  }
  log.info("buttondown sync", {
    action: "lock-acquired",
    acquiredBy: runId,
    attempts,
    waitedMs,
  });

  try {
    const client = createButtondownClient({
      apiKey: process.env.BUTTONDOWN_API_KEY,
      write: options.write,
      logger: (event) => {
        log.info("buttondown http", { ...event, runId });
      },
    });

    const summary = await runButtondownSync({
      client,
      runId,
      write: options.write,
      scopeProfileIds: options.scopeProfileIds,
      log: (event) => {
        if (isSyncLogEvent(event)) {
          // Project each structured event into next-axiom with the
          // "buttondown sync" message; downstream Axiom queries filter
          // on that and split on fields.action.
          log.info("buttondown sync", event as unknown as Record<string, unknown>);
        }
        // Per-profile errors are signal worth paging on. The sync
        // core keeps going (so one bad profile doesn't kill the run)
        // and we re-raise here as a Sentry exception so the alert
        // story doesn't depend on parsing Axiom logs.
        if (event.action === "error") {
          Sentry.captureException(new Error("buttondown.sync_profile_error"), {
            tags: {
              feature: "buttondown-sync",
              action: "sync-error",
              runId,
              errorKind: event.errorKind,
            },
            extra: { profileId: event.profileId, message: event.message },
          });
        }
      },
      raiseUnsubscribeAlert: (alert: UnsubscribeAlert) => {
        // Captured as an exception so Sentry's email-on-error alerting
        // fires; the fingerprint stays stable across runs so an admin
        // sees one issue per affected member rather than per cron.
        Sentry.captureException(new Error("buttondown.unsubscribed_member"), {
          extra: {
            profileId: alert.profileId,
            email: alert.email,
            programSlugsHeld: alert.programSlugsHeld,
            buttondownTagsOnSubscriber: alert.buttondownTagsOnSubscriber,
          },
          tags: { feature: "buttondown-sync", runId, acquiredBy: runId },
        });
      },
    });

    return { status: "ok", summary };
  } finally {
    await releaseLock(LOCK_NAME, runId);
  }
};

/**
 * Best-effort inline hook called from PUT /me on the first save.
 * Swallows all failures: profile-save UX is the priority and the
 * cron is the safety net for whatever this misses. Soft-skips when
 * BUTTONDOWN_API_KEY isn't set (dev / preview).
 */
export const runFirstProfileSaveForServer = async (params: {
  profileId: string;
  email: string;
  write: boolean;
}): Promise<void> => {
  if (!process.env.BUTTONDOWN_API_KEY) return;
  const runId = `first-save:${params.profileId}`;
  try {
    const client = createButtondownClient({
      apiKey: process.env.BUTTONDOWN_API_KEY,
      write: params.write,
      logger: (event) => {
        log.info("buttondown http", { ...event, runId, path_kind: "first-profile-save" });
      },
    });
    await runFirstProfileSaveSync({
      profileId: params.profileId,
      email: params.email,
      client,
      raiseUnsubscribeAlert: (alert: UnsubscribeAlert) => {
        Sentry.captureException(new Error("buttondown.unsubscribed_member"), {
          extra: {
            profileId: alert.profileId,
            email: alert.email,
            programSlugsHeld: alert.programSlugsHeld,
            buttondownTagsOnSubscriber: alert.buttondownTagsOnSubscriber,
          },
          tags: { feature: "buttondown-sync", path: "first-profile-save", runId },
        });
      },
    });
    log.info("buttondown sync", {
      action: "first-profile-save-applied",
      profileId: params.profileId,
      runId,
      write: params.write,
    });
  } catch (err) {
    log.warn("buttondown sync", {
      action: "first-profile-save-failed",
      profileId: params.profileId,
      runId,
      message: err instanceof Error ? err.message : String(err),
    });
    Sentry.captureException(err, {
      tags: { feature: "buttondown-sync", path: "first-profile-save", runId },
      extra: { profileId: params.profileId },
    });
  }
};

/**
 * Reasons an inline per-profile resync fires. Each shows up as a
 * Sentry tag and an Axiom field, so we can ask "how often does a
 * program-join trigger a resync that ends in an error?" without
 * parsing log strings.
 */
export type ProfileResyncReason = "join-program" | "leave-program" | "admin-remove-participant";

/**
 * Best-effort inline resync for a single profile. Called from the
 * program join / leave / admin-remove handlers so a tag change shows
 * up in Buttondown within the request instead of after the next
 * cron. Delegates to the broad runner with a single-profile scope —
 * inheriting its lock, Sentry alerting, HTTP telemetry, and
 * dry-run-vs-write gate. Swallows top-level errors so the user's
 * action isn't blocked; the cron catches up on anything missed.
 */
export const runProfileResyncForServer = async (params: {
  profileId: string;
  reason: ProfileResyncReason;
  write: boolean;
}): Promise<void> => {
  if (!process.env.BUTTONDOWN_API_KEY) return;
  try {
    const result = await runButtondownSyncForServer({
      acquiredBy: `resync:${params.reason}:${params.profileId}`,
      write: params.write,
      scopeProfileIds: [params.profileId],
      // Inline resync is user-triggered, so brief contention with the
      // cron or another inline action should be hidden, not paged.
      // Two retries at 500ms each = up to 1s wait — covers the typical
      // sub-second inline run and the long tail (~P90).
      lockRetries: 2,
      lockRetryDelayMs: 500,
    });
    log.info("buttondown sync", {
      action: "profile-resync-applied",
      profileId: params.profileId,
      reason: params.reason,
      status: result.status,
      ...(result.status === "skipped" ? { skipReason: result.reason } : {}),
    });
  } catch (err) {
    log.warn("buttondown sync", {
      action: "profile-resync-failed",
      profileId: params.profileId,
      reason: params.reason,
      message: err instanceof Error ? err.message : String(err),
    });
    Sentry.captureException(err, {
      tags: { feature: "buttondown-sync", path: "profile-resync", reason: params.reason },
      extra: { profileId: params.profileId },
    });
  }
};
