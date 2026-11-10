// The ordered steps of the welcome/onboarding flow. /welcome/<step>
// renders each one; see docs/design-welcome.md.
export type WelcomeStep = "agreements" | "profile" | "programs";

// The three profile columns that mark a welcome step done. Only
// presence is checked, so the value's type (a Date from the database,
// a string off the wire) doesn't matter.
export type WelcomeMarkers = {
  lastSignedAgreements: unknown;
  lastUpdatedProfile: unknown;
  lastReviewedPrograms: unknown;
};

// Returns the first welcome step the member has not yet completed, or
// null when onboarding is done. Drives both the home-page gate and the
// /welcome index redirect. Each step's marker is a profiles column.
//
// Agreements version-gating is not wired up yet — a member who has
// signed once is never re-prompted. See AGREEMENTS_UPDATED_AT in
// src/app/welcome/agreements/agreements-content.tsx.
export function welcomeEntryStep(profile: WelcomeMarkers | null | undefined): WelcomeStep | null {
  if (!profile) return null;
  if (!profile.lastSignedAgreements) return "agreements";
  if (!profile.lastUpdatedProfile) return "profile";
  if (!profile.lastReviewedPrograms) return "programs";
  return null;
}
