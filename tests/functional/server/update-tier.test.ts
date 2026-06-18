import { describe, expect, it } from "vitest";

import {
  type BuildIdentity,
  computeUpdateTier,
  FEATURE_INITIAL_HOLD_MS,
  isUpdateDue,
  type LiveVersion,
  PATCH_INITIAL_HOLD_MS,
  REPEAT_HOLD_MS,
} from "@/lib/update-tier";

const build = (over: Partial<BuildIdentity> = {}): BuildIdentity => ({
  id: "dep_old",
  appVersion: "2026-06-01",
  builtAt: "2026-06-01T00:00:00.000Z",
  ...over,
});

const live = (over: Partial<LiveVersion> = {}): LiveVersion => ({
  id: "dep_old",
  appVersion: "2026-06-01",
  urgentReleasedAt: "1970-01-01T00:00:00.000Z",
  ...over,
});

describe("computeUpdateTier", () => {
  it("is null when the tab is on the current deployment", () => {
    // Same id — nothing newer exists, whatever the other fields say.
    expect(computeUpdateTier(build(), live())).toBeNull();
    expect(
      computeUpdateTier(build(), live({ appVersion: "2026-07-01", urgentReleasedAt: "2027-01-01T00:00:00.000Z" })),
    ).toBeNull();
  });

  it("is patch when a newer deploy adds no changelog entry or urgent marker", () => {
    expect(computeUpdateTier(build(), live({ id: "dep_new" }))).toBe("patch");
  });

  it("is feature when the changelog advanced since the build", () => {
    expect(computeUpdateTier(build(), live({ id: "dep_new", appVersion: "2026-06-05" }))).toBe("feature");
  });

  it("is urgent when an urgent deploy's marker post-dates the build", () => {
    expect(computeUpdateTier(build(), live({ id: "dep_new", urgentReleasedAt: "2026-06-02T00:00:00.000Z" }))).toBe(
      "urgent",
    );
  });

  it("ranks urgent over a simultaneous feature", () => {
    expect(
      computeUpdateTier(
        build(),
        live({ id: "dep_new", appVersion: "2026-06-05", urgentReleasedAt: "2026-06-02T00:00:00.000Z" }),
      ),
    ).toBe("urgent");
  });

  it("ranks feature over patch", () => {
    // appVersion advanced (feature) while the urgent marker stays in the
    // past (not urgent) — feature wins over the bare patch fallback.
    expect(computeUpdateTier(build(), live({ id: "dep_new", appVersion: "2026-06-05" }))).toBe("feature");
  });

  it("treats an urgent marker at or before the build time as not urgent", () => {
    // The build already contains that fix (built at or after it), so it
    // falls through to patch.
    expect(computeUpdateTier(build(), live({ id: "dep_new", urgentReleasedAt: "2026-06-01T00:00:00.000Z" }))).toBe(
      "patch",
    );
    expect(computeUpdateTier(build(), live({ id: "dep_new", urgentReleasedAt: "2026-05-31T00:00:00.000Z" }))).toBe(
      "patch",
    );
  });

  it("treats an equal (or older) live appVersion as not a feature", () => {
    expect(computeUpdateTier(build(), live({ id: "dep_new", appVersion: "2026-06-01" }))).toBe("patch");
    expect(computeUpdateTier(build(), live({ id: "dep_new", appVersion: "2026-05-01" }))).toBe("patch");
  });
});

describe("isUpdateDue", () => {
  const builtAt = "2026-06-01T00:00:00.000Z";
  const builtMs = Date.parse(builtAt);

  it("holds until the build reaches the tier's initial hold", () => {
    // Patch waits PATCH_INITIAL_HOLD_MS (6h); feature FEATURE_INITIAL_HOLD_MS (2h).
    expect(isUpdateDue(builtAt, builtMs + PATCH_INITIAL_HOLD_MS - 1, PATCH_INITIAL_HOLD_MS, null)).toBe(false);
    expect(isUpdateDue(builtAt, builtMs + PATCH_INITIAL_HOLD_MS, PATCH_INITIAL_HOLD_MS, null)).toBe(true);
    expect(isUpdateDue(builtAt, builtMs + FEATURE_INITIAL_HOLD_MS - 1, FEATURE_INITIAL_HOLD_MS, null)).toBe(false);
    expect(isUpdateDue(builtAt, builtMs + FEATURE_INITIAL_HOLD_MS, FEATURE_INITIAL_HOLD_MS, null)).toBe(true);
  });

  it("stays quiet within REPEAT_HOLD_MS of a dismissal, then returns", () => {
    const now = builtMs + 5 * REPEAT_HOLD_MS; // well past either initial hold
    expect(isUpdateDue(builtAt, now, PATCH_INITIAL_HOLD_MS, now - 1)).toBe(false);
    expect(isUpdateDue(builtAt, now, PATCH_INITIAL_HOLD_MS, now - (REPEAT_HOLD_MS - 1))).toBe(false);
    // Boundary is inclusive: exactly REPEAT_HOLD_MS since the dismissal.
    expect(isUpdateDue(builtAt, now, PATCH_INITIAL_HOLD_MS, now - REPEAT_HOLD_MS)).toBe(true);
    expect(isUpdateDue(builtAt, now, PATCH_INITIAL_HOLD_MS, now - (REPEAT_HOLD_MS + 1))).toBe(true);
  });

  it("applies the full reminder window after a dismissal even when the initial hold is shorter", () => {
    // Feature's 2h initial hold has long passed, but a dismissal still quiets
    // it for the full 8h reminder window.
    const now = builtMs + 5 * REPEAT_HOLD_MS;
    expect(isUpdateDue(builtAt, now, FEATURE_INITIAL_HOLD_MS, now - FEATURE_INITIAL_HOLD_MS)).toBe(false);
  });
});
