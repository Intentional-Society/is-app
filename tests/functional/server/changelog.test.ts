import { describe, expect, it } from "vitest";

import { appVersion, changelog, formatChangelogDate } from "@/lib/changelog";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("changelog data", () => {
  it("has at least one entry", () => {
    expect(changelog.length).toBeGreaterThan(0);
  });

  it("stays sorted newest-first", () => {
    // The /about page renders entries top-down and `appVersion` reads
    // changelog[0]; a misplaced entry must fail here, not in production.
    for (let i = 1; i < changelog.length; i++) {
      expect(changelog[i - 1].date >= changelog[i].date).toBe(true);
    }
  });

  it("uses valid ISO dates and non-empty copy", () => {
    for (const entry of changelog) {
      expect(entry.date).toMatch(ISO_DATE);
      expect(Number.isNaN(Date.parse(entry.date))).toBe(false);
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("appVersion", () => {
  it("is the date of the newest entry", () => {
    expect(appVersion).toBe(changelog[0].date);
  });
});

describe("formatChangelogDate", () => {
  it("formats an ISO date as a long en-US date, pinned to UTC", () => {
    expect(formatChangelogDate("2026-05-29")).toBe("May 29, 2026");
    // A date that would roll back a day in negative-offset timezones if
    // not pinned to UTC.
    expect(formatChangelogDate("2026-01-01")).toBe("January 1, 2026");
  });
});
