// Buttondown sync — the daily cron's core reconciliation logic.
//
// See docs/design-buttondown.md, particularly the "Daily reconciler"
// and "Write policy" sections.
//
// This function is the diff-only path: it brings each app member's
// Buttondown subscriber tags into agreement with the program
// memberships in our database, leaving all non-managed tags (human
// edits, the `isweb-member` / `new` / `returning` markers) alone.
//
// The authoritative full-overwrite path that runs at first profile
// save lives in a separate function — see `runFirstProfileSaveSync`.
// Both share the underlying client; only this function is what the
// cron and the admin "Sync now" buttons drive.

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import {
  type ButtondownClient,
  ButtondownApiError,
  type ButtondownSubscriber,
  isDryRunOutcome,
  type UpdateSubscriberInput,
} from "./buttondown";
import { db } from "./db";
import { authUsers, profilePrograms, profiles, programs } from "./schema";

/**
 * Inline first-profile-save hook. Called from PUT /me when the
 * profile was being saved for the first time (lastUpdatedProfile was
 * NULL before the save). The "one moment" of full-overwrite tag
 * writes — see docs/design-buttondown.md → "Write policy".
 *
 * Behavior per the design:
 *   - Missing subscriber → POST create with [...program_tags, "isweb-member", "new"].
 *   - Unsubscribed → don't write; raise alert.
 *   - Active with `isweb-member` already → no-op (the app has
 *     authoritatively touched this subscriber on a previous run and
 *     overwriting now risks clobbering tags humans set since).
 *   - Active without `isweb-member` → full-overwrite PATCH with
 *     [...program_tags, "isweb-member", "returning"]. Clears any
 *     legacy markers like `active`.
 *
 * Best-effort: callers swallow failures so the profile save itself
 * succeeds. The daily cron picks up any miss.
 */
export const runFirstProfileSaveSync = async (params: {
  profileId: string;
  email: string;
  client: ButtondownClient;
  raiseUnsubscribeAlert?: (alert: UnsubscribeAlert) => void;
}): Promise<void> => {
  const { profileId, email, client } = params;

  // This profile's current tagged-program memberships — same shape
  // the daily reconciler computes but for one profile only.
  const memberships = await db
    .select({ buttondownTag: programs.buttondownTag, slug: programs.slug })
    .from(profilePrograms)
    .innerJoin(programs, eq(programs.id, profilePrograms.programId))
    .where(
      and(
        eq(profilePrograms.profileId, profileId),
        isNull(profilePrograms.leftAt),
        isNull(programs.archivedAt),
        isNotNull(programs.buttondownTag),
      ),
    );

  const desiredTags: string[] = [];
  const slugs: string[] = [];
  for (const m of memberships) {
    if (m.buttondownTag && !desiredTags.includes(m.buttondownTag)) desiredTags.push(m.buttondownTag);
    if (!slugs.includes(m.slug)) slugs.push(m.slug);
  }

  const subscriber = await client.getSubscriber(email);

  if (!subscriber) {
    const result = await client.createSubscriber({
      email_address: email,
      tags: [...desiredTags, "isweb-member", "new"],
    });
    if (!isDryRunOutcome(result)) {
      await db
        .update(profiles)
        .set({ buttondownSubscriberId: result.id })
        .where(eq(profiles.id, profileId));
    }
    return;
  }

  // Record the discovered id immediately — every "found subscriber"
  // branch below benefits from future runs using id-based lookup,
  // even the no-op "already has isweb-member" case.
  await db
    .update(profiles)
    .set({ buttondownSubscriberId: subscriber.id })
    .where(eq(profiles.id, profileId));

  if (subscriber.type === "unsubscribed") {
    params.raiseUnsubscribeAlert?.({
      profileId,
      email,
      programSlugsHeld: slugs,
      buttondownTagsOnSubscriber: subscriber.tags,
    });
    return;
  }

  if (subscriber.tags.includes("isweb-member")) {
    // Already authoritatively touched by the app on a previous run;
    // don't clobber tags humans have added since.
    return;
  }

  await client.updateSubscriber(subscriber.id, {
    tags: [...desiredTags, "isweb-member", "returning"],
  });
};

/**
 * Coarse category for a thrown error, attached to `error` events so
 * Axiom alerts can split "Buttondown is having a bad day" (server)
 * from "our key is wrong" (auth) from "we're hammering the API"
 * (rate-limit). Anything we can't classify falls into `other` —
 * downstream alerts should still react to that bucket.
 */
export type SyncErrorKind = "auth" | "rate-limit" | "not-found" | "server" | "other";

export const classifyError = (err: unknown): SyncErrorKind => {
  if (err instanceof ButtondownApiError) {
    if (err.status === 401 || err.status === 403) return "auth";
    if (err.status === 429) return "rate-limit";
    if (err.status === 404) return "not-found";
    if (err.status >= 500) return "server";
  }
  return "other";
};

/** Structured event the sync emits to the caller's logger. */
export type SyncLogEvent =
  | { action: "summary"; runId: string } & Omit<SyncRunSummary, "runId" | "write">
  | { action: "subscriber-created"; runId: string; profileId: string; subscriberId: string | null; dryRun: boolean }
  | {
      action: "tags-updated";
      runId: string;
      profileId: string;
      subscriberId: string;
      added: string[];
      removed: string[];
      dryRun: boolean;
    }
  | { action: "email-updated"; runId: string; profileId: string; subscriberId: string; from: string; to: string; dryRun: boolean }
  | { action: "unsubscribe-alert"; runId: string; profileId: string; email: string; programSlugsHeld: string[] }
  | { action: "skipped-missing-email"; runId: string; profileId: string }
  | { action: "skipped-already-current"; runId: string; profileId: string; subscriberId: string }
  | { action: "error"; runId: string; profileId: string; message: string; errorKind: SyncErrorKind };

export type SyncLogger = (event: SyncLogEvent) => void;

export type UnsubscribeAlert = {
  profileId: string;
  email: string;
  programSlugsHeld: string[];
  buttondownTagsOnSubscriber: string[];
};

export type SyncRunSummary = {
  runId: string;
  write: boolean;
  scanned: number;
  created: number;
  tagsUpdated: number;
  emailUpdated: number;
  unchanged: number;
  unsubscribeAlerts: number;
  missingProfileEmail: number;
  errors: number;
  // Wall-clock duration of the run, from entry to summary emission.
  // Use for the "is this cron getting slower?" trend in Axiom.
  durationMs: number;
};

export type SyncDeps = {
  client: ButtondownClient;
  runId: string;
  // Whether this run was invoked with write intent. The client itself
  // enforces the gate; we just thread it through to the summary and
  // logs for observability.
  write: boolean;
  // Restrict the reconciler to a specific set of profile ids. Omit
  // for the daily broad sweep; pass for per-member resync paths and
  // for tests that must not touch profiles from other workers.
  scopeProfileIds?: string[];
  log?: SyncLogger;
  raiseUnsubscribeAlert?: (alert: UnsubscribeAlert) => void;
};

type ProfileRow = {
  profileId: string;
  email: string | null;
  buttondownSubscriberId: string | null;
};

type ProfileMembership = {
  profileId: string;
  programSlug: string;
  buttondownTag: string;
};

// Compute the set of every Buttondown tag that any program has marked
// as "managed" — used to decide which tags on a subscriber the sync
// has authority over.
const buildManagedUniverse = async (): Promise<Set<string>> => {
  const tagged = await db
    .select({ buttondownTag: programs.buttondownTag })
    .from(programs)
    .where(isNotNull(programs.buttondownTag));
  const out = new Set<string>();
  for (const t of tagged) {
    if (t.buttondownTag) out.add(t.buttondownTag);
  }
  return out;
};

// Load the current (leftAt IS NULL) memberships for non-archived
// programs that have a buttondownTag set, joined with the program so
// we have the tag string at hand. The result is what feeds the
// per-profile "desired tags" map.
//
// `scopeProfileIds`, when provided, narrows the query to that subset.
// Used by per-member resync paths (future admin "sync this member"
// button) and by tests, so the broad reconciler doesn't act outside
// its caller's intended blast radius.
const loadCurrentTaggedMemberships = async (
  scopeProfileIds?: string[],
): Promise<ProfileMembership[]> => {
  const conditions = [
    isNull(profilePrograms.leftAt),
    isNull(programs.archivedAt),
    isNotNull(programs.buttondownTag),
  ];
  if (scopeProfileIds) {
    if (scopeProfileIds.length === 0) return [];
    conditions.push(inArray(profilePrograms.profileId, scopeProfileIds));
  }
  return db
    .select({
      profileId: profilePrograms.profileId,
      programSlug: programs.slug,
      buttondownTag: programs.buttondownTag,
    })
    .from(profilePrograms)
    .innerJoin(programs, eq(programs.id, profilePrograms.programId))
    .where(and(...conditions))
    .then((rows) =>
      rows
        .filter((r): r is { profileId: string; programSlug: string; buttondownTag: string } => r.buttondownTag !== null),
    );
};

// All profiles with a saved profile (lastUpdatedProfile non-null) and
// the email from auth.users. Members whose profile was created but
// who haven't saved are out of scope. `scopeProfileIds` narrows the
// scan; see loadCurrentTaggedMemberships.
const loadEligibleProfiles = async (scopeProfileIds?: string[]): Promise<ProfileRow[]> => {
  const conditions = [isNotNull(profiles.lastUpdatedProfile)];
  if (scopeProfileIds) {
    if (scopeProfileIds.length === 0) return [];
    conditions.push(inArray(profiles.id, scopeProfileIds));
  }
  return db
    .select({
      profileId: profiles.id,
      email: authUsers.email,
      buttondownSubscriberId: profiles.buttondownSubscriberId,
    })
    .from(profiles)
    .innerJoin(authUsers, eq(authUsers.id, profiles.id))
    .where(and(...conditions));
};

// Compute (final tag set, removed-from-managed, added-to-managed)
// from the subscriber's current tags and the per-profile desired set.
// Non-managed tags (human edits, standing markers) are preserved.
const reconcileTags = (
  currentTags: string[],
  desired: string[],
  managedUniverse: Set<string>,
): { finalTags: string[]; added: string[]; removed: string[]; changed: boolean } => {
  const desiredSet = new Set(desired);
  const current = new Set(currentTags);

  // Preserve every existing tag that is either outside our authority
  // or in the desired set; drop the rest. Then add anything in
  // `desired` that isn't already there.
  const final = new Set<string>();
  for (const t of currentTags) {
    if (!managedUniverse.has(t) || desiredSet.has(t)) final.add(t);
  }
  for (const t of desired) final.add(t);

  const added: string[] = [];
  const removed: string[] = [];
  for (const t of final) {
    if (!current.has(t)) added.push(t);
  }
  for (const t of currentTags) {
    if (!final.has(t)) removed.push(t);
  }

  return {
    finalTags: [...final],
    added,
    removed,
    changed: added.length > 0 || removed.length > 0,
  };
};

const recordSubscriberId = async (profileId: string, subscriberId: string): Promise<void> => {
  await db
    .update(profiles)
    .set({ buttondownSubscriberId: subscriberId })
    .where(eq(profiles.id, profileId));
};

export const runButtondownSync = async (deps: SyncDeps): Promise<SyncRunSummary> => {
  const { client, runId, write } = deps;
  const log: SyncLogger = deps.log ?? (() => {});
  const raise = deps.raiseUnsubscribeAlert ?? (() => {});
  const startedAt = Date.now();

  const summary: SyncRunSummary = {
    runId,
    write,
    scanned: 0,
    created: 0,
    tagsUpdated: 0,
    emailUpdated: 0,
    unchanged: 0,
    unsubscribeAlerts: 0,
    missingProfileEmail: 0,
    errors: 0,
    durationMs: 0,
  };

  const [managedUniverse, profileRows, memberships] = await Promise.all([
    buildManagedUniverse(),
    loadEligibleProfiles(deps.scopeProfileIds),
    loadCurrentTaggedMemberships(deps.scopeProfileIds),
  ]);

  // Group memberships by profile so each iteration is one lookup.
  const desiredByProfile = new Map<string, { tags: string[]; slugs: string[] }>();
  for (const m of memberships) {
    const entry = desiredByProfile.get(m.profileId) ?? { tags: [], slugs: [] };
    if (!entry.tags.includes(m.buttondownTag)) entry.tags.push(m.buttondownTag);
    if (!entry.slugs.includes(m.programSlug)) entry.slugs.push(m.programSlug);
    desiredByProfile.set(m.profileId, entry);
  }

  for (const profile of profileRows) {
    summary.scanned++;
    try {
      await syncOneProfile({
        profile,
        desired: desiredByProfile.get(profile.profileId) ?? { tags: [], slugs: [] },
        managedUniverse,
        client,
        runId,
        log,
        raise,
        summary,
      });
    } catch (err) {
      summary.errors++;
      log({
        action: "error",
        runId,
        profileId: profile.profileId,
        message: err instanceof Error ? err.message : String(err),
        errorKind: classifyError(err),
      });
    }
  }

  summary.durationMs = Date.now() - startedAt;
  log({ action: "summary", runId, ...summaryWithoutMeta(summary) });
  return summary;
};

const summaryWithoutMeta = (s: SyncRunSummary) => {
  const { runId: _r, write: _w, ...rest } = s;
  return rest;
};

type SyncOneProfileArgs = {
  profile: ProfileRow;
  desired: { tags: string[]; slugs: string[] };
  managedUniverse: Set<string>;
  client: ButtondownClient;
  runId: string;
  log: SyncLogger;
  raise: (alert: UnsubscribeAlert) => void;
  summary: SyncRunSummary;
};

const syncOneProfile = async (args: SyncOneProfileArgs): Promise<void> => {
  const { profile, desired, managedUniverse, client, runId, log, raise, summary } = args;
  const profileId = profile.profileId;

  if (!profile.email) {
    summary.missingProfileEmail++;
    log({ action: "skipped-missing-email", runId, profileId });
    return;
  }
  const email = profile.email;

  // Prefer id-based lookup (stable across email changes). Fall back to
  // email for profiles we haven't seen before.
  let subscriber: ButtondownSubscriber | null = null;
  if (profile.buttondownSubscriberId) {
    subscriber = await client.getSubscriber(profile.buttondownSubscriberId);
  }
  if (!subscriber) {
    subscriber = await client.getSubscriber(email);
  }

  if (!subscriber) {
    // Catch-up create: this is the path that runs when the inline
    // first-save hook failed (or hasn't shipped yet). Tag with the
    // managed set + isweb-member + new.
    const result = await client.createSubscriber({
      email_address: email,
      tags: [...desired.tags, "isweb-member", "new"],
    });
    summary.created++;
    const subscriberId = isDryRunOutcome(result) ? null : result.id;
    if (subscriberId !== null) await recordSubscriberId(profileId, subscriberId);
    log({
      action: "subscriber-created",
      runId,
      profileId,
      subscriberId,
      dryRun: isDryRunOutcome(result),
    });
    return;
  }

  // Subscriber exists — record id if we didn't have it. Always safe;
  // the column is just a lookup hint.
  if (profile.buttondownSubscriberId !== subscriber.id) {
    await recordSubscriberId(profileId, subscriber.id);
  }

  if (subscriber.type === "unsubscribed") {
    summary.unsubscribeAlerts++;
    raise({
      profileId,
      email,
      programSlugsHeld: desired.slugs,
      buttondownTagsOnSubscriber: subscriber.tags,
    });
    log({
      action: "unsubscribe-alert",
      runId,
      profileId,
      email,
      programSlugsHeld: desired.slugs,
    });
    return;
  }

  const { finalTags, added, removed, changed } = reconcileTags(
    subscriber.tags,
    desired.tags,
    managedUniverse,
  );
  const emailMismatch = subscriber.email_address.toLowerCase() !== email.toLowerCase();

  if (!changed && !emailMismatch) {
    summary.unchanged++;
    log({ action: "skipped-already-current", runId, profileId, subscriberId: subscriber.id });
    return;
  }

  const patch: UpdateSubscriberInput = {};
  if (changed) patch.tags = finalTags;
  if (emailMismatch) patch.email_address = email;

  const result = await client.updateSubscriber(subscriber.id, patch);
  const dryRun = isDryRunOutcome(result);

  if (changed) {
    summary.tagsUpdated++;
    log({
      action: "tags-updated",
      runId,
      profileId,
      subscriberId: subscriber.id,
      added,
      removed,
      dryRun,
    });
  }
  if (emailMismatch) {
    summary.emailUpdated++;
    log({
      action: "email-updated",
      runId,
      profileId,
      subscriberId: subscriber.id,
      from: subscriber.email_address,
      to: email,
      dryRun,
    });
  }
};
