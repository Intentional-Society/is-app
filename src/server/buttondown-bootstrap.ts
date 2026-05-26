// One-shot bootstrap reconciliation for the cutover from the Apps
// Script flow to the app-driven Buttondown sync.
//
// See docs/design-buttondown.md → "Initial bootstrap reconciliation".
// The bootstrap is app-side-only: Buttondown is authoritative for tag
// state, so where the two systems disagree on a member's program
// memberships we call `leaveProgram` to bring the app into alignment.
// The bootstrap never writes to Buttondown — the inline first-profile-
// save path is the one authoritative overwrite moment, and the daily
// cron handles steady-state Buttondown writes thereafter.
//
// This module is invoked by `scripts/buttondown-bootstrap.ts`, never
// by request paths. The script is the only intended caller.

import { and, eq, isNotNull, isNull } from "drizzle-orm";

import type { ButtondownSubscriber } from "./buttondown";
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

export type ProgramRef = { programId: string; programSlug: string };

export type BootstrapPlan =
  | { kind: "skip-missing-email" }
  | { kind: "skip-missing-subscriber"; tried: string[] }
  | { kind: "skip-unsubscribed"; subscriberId: string }
  | { kind: "skip-no-isweb-member"; subscriberId: string; currentTags: string[] }
  | { kind: "skip-no-changes"; subscriberId: string }
  | {
      kind: "reconcile";
      subscriberId: string;
      programsToLeave: ProgramRef[];
      // Observation-only at this revision: the cron's diff-only path
      // would actively REMOVE these tags from Buttondown the morning
      // after the bootstrap (its formula treats the app's empty side
      // as authoritative), so leaving them as "do nothing" silently
      // destroys Apps-Script-era memberships. We surface them in the
      // dry-run output so the operator can size the problem; whether
      // applyBootstrapForMember should call joinProgram is the next
      // decision after eyeballing the data.
      programsToJoin: ProgramRef[];
    };

// Pure decision function. Given the member's app-side state, the set
// of tag-bearing programs they're currently joined to, the universe
// of tag-bearing programs in the app, and what Buttondown shows,
// decide what to do. No I/O.
export const planBootstrap = (params: {
  subscriber: ButtondownSubscriber | null;
  appJoinedTaggedPrograms: ProgramByTag[];
  programsByTag: Map<string, ProgramRef>;
}): BootstrapPlan => {
  const { subscriber, appJoinedTaggedPrograms, programsByTag } = params;

  if (!subscriber) {
    return { kind: "skip-missing-subscriber", tried: [] };
  }
  if (subscriber.type === "unsubscribed") {
    return { kind: "skip-unsubscribed", subscriberId: subscriber.id };
  }
  // The bootstrap matches CSV-imported app rows against an audience
  // that also contains non-member newsletter subscribers. A missing
  // `isweb-member` tag means the email landed on a subscriber the app
  // never claimed — likely a non-member newsletter collision rather
  // than this IS Web member. Flag for human review rather than silently
  // adopt; the inline first-profile-save path is the right place to
  // claim a subscriber, not this one.
  if (!subscriber.tags.includes("isweb-member")) {
    return { kind: "skip-no-isweb-member", subscriberId: subscriber.id, currentTags: subscriber.tags };
  }

  // Buttondown's view of the managed-tag intersection — the source of
  // truth for what programs the member is "really" in for this
  // bootstrap moment.
  const buttondownManagedTags = new Set(subscriber.tags.filter((t) => programsByTag.has(t)));
  const appJoinedTags = new Set(appJoinedTaggedPrograms.map((p) => p.buttondownTag));

  // Two directions to reconcile, both with Buttondown authoritative:
  //   - app says joined, Buttondown disagrees → leaveProgram.
  //   - Buttondown says joined, app disagrees → would be joinProgram.
  const programsToLeave: ProgramRef[] = [];
  for (const p of appJoinedTaggedPrograms) {
    if (!buttondownManagedTags.has(p.buttondownTag)) {
      programsToLeave.push({ programId: p.programId, programSlug: p.programSlug });
    }
  }
  const programsToJoin: ProgramRef[] = [];
  for (const tag of buttondownManagedTags) {
    if (!appJoinedTags.has(tag)) {
      const program = programsByTag.get(tag);
      if (program) programsToJoin.push(program);
    }
  }

  if (programsToLeave.length === 0 && programsToJoin.length === 0) {
    return { kind: "skip-no-changes", subscriberId: subscriber.id };
  }

  return { kind: "reconcile", subscriberId: subscriber.id, programsToLeave, programsToJoin };
};

// Load every app member, including CSV-imported stubs who haven't
// completed onboarding yet. Those stubs already carry program
// memberships from the import, so they belong in the bootstrap pass
// even though `lastUpdatedProfile` is still null — without them the
// app-side reconcile waits until each member's first sign-in, which
// could be never.
export const loadBootstrapMembers = async (): Promise<BootstrapMemberRecord[]> => {
  return db
    .select({
      profileId: profiles.id,
      displayName: profiles.displayName,
      email: authUsers.email,
      buttondownSubscriberId: profiles.buttondownSubscriberId,
    })
    .from(profiles)
    .innerJoin(authUsers, eq(authUsers.id, profiles.id));
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

// All non-archived tag-bearing programs, indexed by buttondownTag.
// Archived programs are excluded: a bootstrap join into an archived
// program would be nonsensical, and the symmetric leave direction
// already operates only on non-archived rows (see
// loadJoinedTaggedPrograms).
export const loadProgramsByTag = async (): Promise<Map<string, ProgramRef>> => {
  const rows = await db
    .select({
      programId: programs.id,
      programSlug: programs.slug,
      buttondownTag: programs.buttondownTag,
    })
    .from(programs)
    .where(and(isNotNull(programs.buttondownTag), isNull(programs.archivedAt)));
  const out = new Map<string, ProgramRef>();
  for (const r of rows) {
    if (r.buttondownTag) out.set(r.buttondownTag, { programId: r.programId, programSlug: r.programSlug });
  }
  return out;
};

// Orchestrates one member's bootstrap: looks up Buttondown, decides,
// applies app-side writes. The bootstrap never writes to Buttondown
// (see the module header), so `deps` only needs a subscriber lookup.
// Subscriber resolution goes through a shared `lookup` so the script
// can preload the audience once via listSubscribers (one paginated
// call) instead of doing 1-2 GETs per member.
export type ApplyBootstrapDeps = {
  lookup: SubscriberLookup;
  write: boolean;
};

export const applyBootstrapForMember = async (
  member: BootstrapMemberRecord,
  appJoinedTaggedPrograms: ProgramByTag[],
  programsByTag: Map<string, ProgramRef>,
  deps: ApplyBootstrapDeps,
): Promise<{ plan: BootstrapPlan; applied: boolean }> => {
  if (!member.email) {
    return { plan: { kind: "skip-missing-email" }, applied: false };
  }

  const subscriber = await deps.lookup(member);

  const plan = planBootstrap({
    subscriber,
    appJoinedTaggedPrograms,
    programsByTag,
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

  // Persist a discovered subscriber id for any plan that resolved a
  // healthy IS Web subscriber, so the daily cron's first run after
  // the bootstrap doesn't have to repeat the email lookup. Anomaly
  // plans (unsubscribed, no-isweb-member) are gated behind human
  // review; defer their id persistence until the cron sees them in a
  // healthy state.
  if (
    (plan.kind === "reconcile" || plan.kind === "skip-no-changes") &&
    member.buttondownSubscriberId !== plan.subscriberId
  ) {
    await db
      .update(profiles)
      .set({ buttondownSubscriberId: plan.subscriberId })
      .where(eq(profiles.id, member.profileId));
  }

  if (plan.kind !== "reconcile") {
    return { plan, applied: false };
  }

  // App-side leaves bring the app into alignment with Buttondown,
  // which is authoritative at the bootstrap moment. No Buttondown
  // writes — the daily cron takes over from here.
  for (const p of plan.programsToLeave) {
    await leaveProgram(member.profileId, p.programId);
  }

  return { plan, applied: true };
};
