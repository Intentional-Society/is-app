import { describe, expect, it } from "vitest";

import type { Me } from "@/lib/api-types";
import { welcomeEntryStep } from "@/lib/welcomeEntryStep";

// welcomeEntryStep only inspects three timestamp markers. Build a
// minimal profile carrying just those and cast to the full self shape.
const profileWith = (markers: {
  lastSignedAgreements?: string | null;
  lastUpdatedProfile?: string | null;
  lastReviewedPrograms?: string | null;
}): Me["profile"] =>
  ({
    lastSignedAgreements: null,
    lastUpdatedProfile: null,
    lastReviewedPrograms: null,
    ...markers,
  }) as Me["profile"];

const TS = "2026-05-19T00:00:00Z";

describe("welcomeEntryStep", () => {
  it("returns null when there is no profile", () => {
    expect(welcomeEntryStep(null)).toBeNull();
  });

  it("starts at agreements when nothing is done", () => {
    expect(welcomeEntryStep(profileWith({}))).toBe("agreements");
  });

  it("advances to profile once agreements are signed", () => {
    expect(welcomeEntryStep(profileWith({ lastSignedAgreements: TS }))).toBe("profile");
  });

  it("advances to programs once agreements and profile are done", () => {
    expect(welcomeEntryStep(profileWith({ lastSignedAgreements: TS, lastUpdatedProfile: TS }))).toBe("programs");
  });

  it("returns null once every step is done", () => {
    expect(
      welcomeEntryStep(profileWith({ lastSignedAgreements: TS, lastUpdatedProfile: TS, lastReviewedPrograms: TS })),
    ).toBeNull();
  });

  it("gates on the earliest missing step regardless of later markers", () => {
    // A later marker set without the earlier ones shouldn't happen in
    // practice — the flow is ordered — but the gate stays on agreements.
    expect(welcomeEntryStep(profileWith({ lastReviewedPrograms: TS }))).toBe("agreements");
  });
});
