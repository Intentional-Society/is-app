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

import { and, eq, isNotNull, isNull } from "drizzle-orm";

import {
  type ButtondownClient,
  type ButtondownSubscriber,
  isDryRunOutcome,
  type UpdateSubscriberInput,
} from "./buttondown";
import { db } from "./db";
import { authUsers, profilePrograms, profiles, programs } from "./schema";

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
  | { action: "error"; runId: string; profileId: string; message: string };

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
};

export type SyncDeps = {
  client: ButtondownClient;
  runId: string;
  // Whether this run was invoked with write intent. The client itself
  // enforces the gate; we just thread it through to the summary and
  // logs for observability.
  write: boolean;
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
const loadCurrentTaggedMemberships = async (): Promise<ProfileMembership[]> => {
  return db
    .select({
      profileId: profilePrograms.profileId,
      programSlug: programs.slug,
      buttondownTag: programs.buttondownTag,
    })
    .from(profilePrograms)
    .innerJoin(programs, eq(programs.id, profilePrograms.programId))
    .where(
      and(
        isNull(profilePrograms.leftAt),
        isNull(programs.archivedAt),
        isNotNull(programs.buttondownTag),
      ),
    )
    .then((rows) =>
      rows
        .filter((r): r is { profileId: string; programSlug: string; buttondownTag: string } => r.buttondownTag !== null),
    );
};

// All profiles with a saved profile (lastUpdatedProfile non-null) and
// the email from auth.users. Members whose profile was created but
// who haven't saved are out of scope.
const loadEligibleProfiles = async (): Promise<ProfileRow[]> => {
  return db
    .select({
      profileId: profiles.id,
      email: authUsers.email,
      buttondownSubscriberId: profiles.buttondownSubscriberId,
    })
    .from(profiles)
    .innerJoin(authUsers, eq(authUsers.id, profiles.id))
    .where(isNotNull(profiles.lastUpdatedProfile));
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
  };

  const [managedUniverse, profileRows, memberships] = await Promise.all([
    buildManagedUniverse(),
    loadEligibleProfiles(),
    loadCurrentTaggedMemberships(),
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
      });
    }
  }

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
