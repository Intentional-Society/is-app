import type { Me } from "@/lib/api-types";

// The ordered steps of the welcome/onboarding flow. /welcome/<step>
// renders each one; see docs/design-welcome.md.
export type WelcomeStep = "agreements" | "profile" | "programs";

// Returns the first welcome step the member has not yet completed, or
// null when onboarding is done. Drives both the home-page gate and the
// /welcome index redirect. Each step's marker is a profiles column;
// only presence is checked, so the JSON-string vs Date distinction in
// the wire shape doesn't matter here.
//
// Agreements version-gating is deliberately not wired up yet — a member
// who has signed once is never re-prompted. See AGREEMENTS_UPDATED_AT in
// src/app/welcome/agreements/agreements-content.tsx.
export function welcomeEntryStep(profile: Me["profile"]): WelcomeStep | null {
  if (!profile) return null;
  if (!profile.lastSignedAgreements) return "agreements";
  if (!profile.lastUpdatedProfile) return "profile";
  if (!profile.lastReviewedPrograms) return "programs";
  return null;
}
