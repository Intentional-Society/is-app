// One-shot bootstrap reconciliation for the cutover from the Apps
// Script flow to the app-driven Buttondown sync.
//
// See docs/design-buttondown.md → "Initial bootstrap reconciliation".
// The key difference from the daily reconciler: at the bootstrap
// moment, Buttondown is authoritative for tag state. If the app says
// Alice is currently in `weekly-updates` but Buttondown's subscriber
// lacks that tag, the app side gets corrected (leaveProgram), not
// Buttondown. Then we do a single full-overwrite PATCH to clear any
// legacy tags (e.g. the pre-cutover `active` marker) and lock in the
// canonical state.
//
// This module is invoked by `scripts/buttondown-bootstrap.ts`, never
// by request paths. The script is the only intended caller.

import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { type ButtondownClient, type ButtondownSubscriber, isDryRunOutcome } from "./buttondown";
import type { SubscriberLookup } from "./buttondown-sync";
import { db } from "./db";
import { authUsers, profilePrograms, profiles, programs } from "./schema";
import { leaveProgram } from "./programs";

export type BootstrapMemberRecord = {
  profileId: string;
  displayName: string | null;
  email: string | null;
  buttondownSubscriberId: string | null;
};

export type ProgramByTag = {
  programId: string;
  programSlug: string;
  buttondownTag: string;
};

export type BootstrapPlan =
  | { kind: "skip-missing-email" }
  | { kind: "skip-missing-subscriber"; tried: string[] }
  | { kind: "skip-unsubscribed"; subscriberId: string }
  | {
      kind: "reconcile";
      subscriberId: string;
      programsToLeave: { programId: string; programSlug: string }[];
      finalTags: string[];
    };

// Pure decision function. Given the member's app-side state, the set
// of tag-bearing programs they're currently joined to, and what
// Buttondown shows, decide what to do. No I/O.
export const planBootstrap = (params: {
  subscriber: ButtondownSubscriber | null;
  appJoinedTaggedPrograms: ProgramByTag[];
  managedUniverse: Set<string>;
}): BootstrapPlan => {
  const { subscriber, appJoinedTaggedPrograms, managedUniverse } = params;

  if (!subscriber) {
    return {
      kind: "skip-missing-subscriber",
      tried: [],
    };
  }
  if (subscriber.type === "unsubscribed") {
    return { kind: "skip-unsubscribed", subscriberId: subscriber.id };
  }

  // Buttondown's view of the managed-tag intersection — the source of
  // truth for what programs the member is "really" in for this
  // bootstrap moment.
  const buttondownManagedTags = new Set(subscriber.tags.filter((t) => managedUniverse.has(t)));

  // For each app-side joined-tagged program, decide whether Buttondown
  // confirms the membership. If not, plan a leaveProgram.
  const programsToLeave: { programId: string; programSlug: string }[] = [];
  for (const p of appJoinedTaggedPrograms) {
    if (!buttondownManagedTags.has(p.buttondownTag)) {
      programsToLeave.push({ programId: p.programId, programSlug: p.programSlug });
    }
  }

  // After app-side reconcile, the final managed tag set on the
  // subscriber is exactly what Buttondown already says it is for the
  // managed universe (since Buttondown is authoritative). We pair that
  // with the standing markers: keep `isweb-member` if already there,
  // otherwise add it; same for `returning` (this member predated us).
  const finalTags = [
    ...buttondownManagedTags,
    "isweb-member",
    "returning",
  ];
  // Dedupe in case isweb-member or returning is already in the
  // managed intersection somehow (shouldn't happen — those are
  // standing markers, not managed — but cheap defensive uniquing).
  const seen = new Set<string>();
  const uniqueFinalTags = finalTags.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });

  return {
    kind: "reconcile",
    subscriberId: subscriber.id,
    programsToLeave,
    finalTags: uniqueFinalTags,
  };
};

// Load all profiles with a saved profile (lastUpdatedProfile non-null),
// paired with their auth.users email.
export const loadBootstrapMembers = async (): Promise<BootstrapMemberRecord[]> => {
  return db
    .select({
      profileId: profiles.id,
      displayName: profiles.displayName,
      email: authUsers.email,
      buttondownSubscriberId: profiles.buttondownSubscriberId,
    })
    .from(profiles)
    .innerJoin(authUsers, eq(authUsers.id, profiles.id))
    .where(isNotNull(profiles.lastUpdatedProfile));
};

// Load the current (leftAt IS NULL) memberships for non-archived
// programs with a buttondownTag — same shape the daily reconciler
// uses, indexed by profile id for the bootstrap loop.
export const loadJoinedTaggedPrograms = async (): Promise<Map<string, ProgramByTag[]>> => {
  const rows = await db
    .select({
      profileId: profilePrograms.profileId,
      programId: profilePrograms.programId,
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
    );

  const grouped = new Map<string, ProgramByTag[]>();
  for (const r of rows) {
    if (!r.buttondownTag) continue;
    const arr = grouped.get(r.profileId) ?? [];
    arr.push({
      programId: r.programId,
      programSlug: r.programSlug,
      buttondownTag: r.buttondownTag,
    });
    grouped.set(r.profileId, arr);
  }
  return grouped;
};

export const loadManagedUniverse = async (): Promise<Set<string>> => {
  const rows = await db
    .select({ buttondownTag: programs.buttondownTag })
    .from(programs)
    .where(isNotNull(programs.buttondownTag));
  const out = new Set<string>();
  for (const r of rows) {
    if (r.buttondownTag) out.add(r.buttondownTag);
  }
  return out;
};

// Orchestrates one member's bootstrap: looks up Buttondown, decides,
// applies. Honors the client's `write` flag for Buttondown writes and
// the `write` arg for app-side mutations. Subscriber resolution goes
// through a shared `lookup` so the script can preload the audience
// once via listSubscribers (one paginated call) instead of doing
// 1-2 GETs per member.
export type ApplyBootstrapDeps = {
  client: ButtondownClient;
  lookup: SubscriberLookup;
  write: boolean;
};

export const applyBootstrapForMember = async (
  member: BootstrapMemberRecord,
  appJoinedTaggedPrograms: ProgramByTag[],
  managedUniverse: Set<string>,
  deps: ApplyBootstrapDeps,
): Promise<{ plan: BootstrapPlan; applied: boolean }> => {
  if (!member.email) {
    return { plan: { kind: "skip-missing-email" }, applied: false };
  }

  const subscriber = await deps.lookup(member);

  const plan = planBootstrap({
    subscriber,
    appJoinedTaggedPrograms,
    managedUniverse,
  });

  if (plan.kind === "skip-missing-subscriber") {
    // Reconstruct the lookup attempts for operator debugging — the
    // lookup tries id-first then email when both are present, so
    // surface both whenever they were known.
    const tried: string[] = [];
    if (member.buttondownSubscriberId) tried.push(`id:${member.buttondownSubscriberId}`);
    tried.push(`email:${member.email}`);
    plan.tried = tried;
  }

  if (!deps.write) {
    return { plan, applied: false };
  }
  if (plan.kind !== "reconcile") {
    return { plan, applied: false };
  }

  // Apply app-side leaves first so the next sync (or another
  // bootstrap run) sees consistent app state.
  for (const p of plan.programsToLeave) {
    await leaveProgram(member.profileId, p.programId);
  }

  // Persist the subscriber id if we discovered it via email lookup.
  if (member.buttondownSubscriberId !== plan.subscriberId) {
    await db
      .update(profiles)
      .set({ buttondownSubscriberId: plan.subscriberId })
      .where(eq(profiles.id, member.profileId));
  }

  // Single full-overwrite PATCH locks in the canonical state. The
  // client's write flag still applies — passing write=true on the
  // bootstrap client means this actually goes out; write=false would
  // make this a Buttondown-side dry run while the DB updates above
  // still ran (because the script controls those separately via its
  // own --write flag, which sets both).
  const patchResult = await deps.client.updateSubscriber(plan.subscriberId, { tags: plan.finalTags });
  // isDryRunOutcome is fine to consult; we don't actually need to
  // branch on it since the client's gate already handled the choice.
  void isDryRunOutcome(patchResult);

  return { plan, applied: true };
};
