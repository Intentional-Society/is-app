// Pure update-tier logic for the live-deploy update banner. No React and
// no browser APIs — the hook (use-new-version-available.ts) wires this to
// polling and dismissal state. See docs/strategy-deployment.md.

export type UpdateTier = "patch" | "feature" | "urgent";

// What GET /api/version reports about current production.
export type LiveVersion = {
  id: string;
  appVersion: string;
  urgentReleasedAt: string;
};

// The open tab's frozen identity, baked in at build time.
export type BuildIdentity = {
  id: string;
  appVersion: string;
  builtAt: string;
};

// First-nudge holds: how old the running build must be before each tier's
// banner first appears. Tier-specific — a member-facing feature is worth
// surfacing sooner than a routine patch, but neither interrupts a just-loaded
// session. See docs/strategy-deployment.md.
export const PATCH_INITIAL_HOLD_MS = 6 * 60 * 60 * 1000;
export const FEATURE_INITIAL_HOLD_MS = 2 * 60 * 60 * 1000;

// Reminder cadence: after dismissing either banner, stay quiet this long
// before nudging again — shared by patch and feature. Sits far inside the
// 7-day Skew Protection Max Age, so a dismissed tab is re-nudged well before
// its pin could lapse (docs/strategy-deployment.md).
export const REPEAT_HOLD_MS = 8 * 60 * 60 * 1000;

// The highest-severity tier among deploys newer than this build, or null
// when the tab is already on current production. Severity runs
// urgent > feature > patch: one pending urgent outranks everything, one
// pending feature outranks any number of pending patches.
export function computeUpdateTier(build: BuildIdentity, live: LiveVersion): UpdateTier | null {
  // A matching id proves the tab is on the current deployment — nothing
  // newer exists, so no tier applies.
  if (live.id === build.id) return null;
  // An urgent deploy whose marker post-dates this build: the tab predates
  // a fix older clients must not keep running.
  if (Date.parse(build.builtAt) < Date.parse(live.urgentReleasedAt)) return "urgent";
  // A member-facing changelog entry landed since this build was made.
  if (live.appVersion > build.appVersion) return "feature";
  // Something newer exists, but it is neither urgent nor member-facing.
  return "patch";
}

// Whether a tier's banner should surface yet, given that tier's initial hold.
// The tier waits until the build is `initialHoldMs` old, then — after a
// dismissal — stays quiet for the shared REPEAT_HOLD_MS before nudging again.
// Patch and feature both flow through here, each with its own initial hold and
// its own dismissal timestamp (tracked separately so a feature still pierces a
// dismissed patch); urgent skips it entirely. Several updates across a day thus
// collapse into one eventual nudge, shown at most once per reminder window.
export function isUpdateDue(
  builtAt: string,
  now: number,
  initialHoldMs: number,
  lastDismissalAt: number | null,
): boolean {
  if (now - Date.parse(builtAt) < initialHoldMs) return false;
  if (lastDismissalAt !== null && now - lastDismissalAt < REPEAT_HOLD_MS) return false;
  return true;
}
