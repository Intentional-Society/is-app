import { describe, expect, it } from "vitest";

import { type BuildIdentity, computeUpdateTier, isPatchDue, type LiveVersion, PATCH_HOLD_MS } from "@/lib/update-tier";

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

describe("isPatchDue", () => {
  const builtAt = "2026-06-01T00:00:00.000Z";
  const builtMs = Date.parse(builtAt);

  it("is false until the build is PATCH_HOLD_MS old", () => {
    expect(isPatchDue(builtAt, builtMs, null)).toBe(false);
    expect(isPatchDue(builtAt, builtMs + PATCH_HOLD_MS - 1, null)).toBe(false);
  });

  it("is true once the build is at least PATCH_HOLD_MS old and never dismissed", () => {
    expect(isPatchDue(builtAt, builtMs + PATCH_HOLD_MS, null)).toBe(true);
    expect(isPatchDue(builtAt, builtMs + 5 * PATCH_HOLD_MS, null)).toBe(true);
  });

  it("is false within PATCH_HOLD_MS of a dismissal", () => {
    const now = builtMs + 5 * PATCH_HOLD_MS;
    expect(isPatchDue(builtAt, now, now - 1)).toBe(false);
    expect(isPatchDue(builtAt, now, now - (PATCH_HOLD_MS - 1))).toBe(false);
  });

  it("is true again once PATCH_HOLD_MS has passed since the dismissal", () => {
    const now = builtMs + 5 * PATCH_HOLD_MS;
    // Boundary is inclusive: exactly PATCH_HOLD_MS since the dismissal.
    expect(isPatchDue(builtAt, now, now - PATCH_HOLD_MS)).toBe(true);
    expect(isPatchDue(builtAt, now, now - (PATCH_HOLD_MS + 1))).toBe(true);
  });
});
