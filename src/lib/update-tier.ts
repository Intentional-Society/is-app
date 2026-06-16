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

// The patch-notify window: hold a patch-only nudge until the running
// build is this old, then show it at most once per window. Far shorter
// than the 7-day Skew Protection Max Age, so a patch-only tab is nudged
// well before its pin could lapse (docs/strategy-deployment.md).
export const PATCH_HOLD_MS = 12 * 60 * 60 * 1000;

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

// Whether a *patch* update should surface yet. Feature and urgent are
// immediate and never pass through here. A patch waits until the build is
// at least PATCH_HOLD_MS old, then stays quiet for another PATCH_HOLD_MS
// after a dismissal — so several patches across a day collapse into one
// eventual nudge, shown at most once per window.
export function isPatchDue(builtAt: string, now: number, lastPatchDismissalAt: number | null): boolean {
  if (now - Date.parse(builtAt) < PATCH_HOLD_MS) return false;
  if (lastPatchDismissalAt !== null && now - lastPatchDismissalAt < PATCH_HOLD_MS) return false;
  return true;
}
