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
import { runButtondownSync, type SyncLogEvent, type SyncRunSummary, type UnsubscribeAlert } from "./buttondown-sync";
import { acquireLock, releaseLock } from "./sync-locks";

const LOCK_NAME = "buttondown";

export type RunButtondownSyncOptions = {
  // Identifier for this run, recorded on the lock and in every log
  // event. Cron uses "cron:<iso-timestamp>"; admin uses
  // "admin:<profileId>:<dry-run|write>".
  acquiredBy: string;
  // Whether this run is allowed to write. The client itself enforces
  // the gate; the runner threads it through and uses it in logs.
  write: boolean;
};

export type RunResult =
  | { status: "ok"; summary: SyncRunSummary }
  | { status: "skipped"; reason: "api_key_missing" | "lock_held" };

const isSyncLogEvent = (event: SyncLogEvent): event is SyncLogEvent => event !== undefined;

export const runButtondownSyncForServer = async (options: RunButtondownSyncOptions): Promise<RunResult> => {
  // Lock #2 from the design doc's "Prod-only by construction" — the
  // sync is a no-op in any environment without the API key. This is
  // the only gate the inline first-save path will share with this
  // path, so it's intentionally a soft skip rather than an error.
  if (!process.env.BUTTONDOWN_API_KEY) {
    log.warn("buttondown sync", { action: "skipped-api-key-missing", acquiredBy: options.acquiredBy });
    return { status: "skipped", reason: "api_key_missing" };
  }

  const got = await acquireLock(LOCK_NAME, options.acquiredBy);
  if (!got) {
    log.warn("buttondown sync", { action: "skipped-lock-held", acquiredBy: options.acquiredBy });
    return { status: "skipped", reason: "lock_held" };
  }

  try {
    const client = createButtondownClient({
      apiKey: process.env.BUTTONDOWN_API_KEY,
      write: options.write,
    });

    const summary = await runButtondownSync({
      client,
      runId: options.acquiredBy,
      write: options.write,
      log: (event) => {
        if (isSyncLogEvent(event)) {
          // Project each structured event into next-axiom with the
          // "buttondown sync" message; downstream Axiom queries filter
          // on that and split on fields.action.
          log.info("buttondown sync", event as unknown as Record<string, unknown>);
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
          tags: { feature: "buttondown-sync" },
        });
      },
    });

    return { status: "ok", summary };
  } finally {
    await releaseLock(LOCK_NAME, options.acquiredBy);
  }
};
