import { describe, expect, it } from "vitest";

import { parseStoredSpacing, SPACING_MAX, SPACING_MIN } from "@/app/myweb/query-keys";

describe("parseStoredSpacing", () => {
  it("accepts an in-range multiplier", () => {
    expect(parseStoredSpacing("1.1")).toBe(1.1);
  });

  it("clamps an over-range value to the max", () => {
    expect(parseStoredSpacing("9")).toBe(SPACING_MAX);
  });

  it("clamps an under-range value to the min", () => {
    expect(parseStoredSpacing("0.1")).toBe(SPACING_MIN);
  });

  it("rejects ±Infinity (a JSON number that overflowed)", () => {
    expect(parseStoredSpacing("1e999")).toBeNull();
  });

  it("rejects a missing, mistyped, or garbled value as null", () => {
    expect(parseStoredSpacing(null)).toBeNull();
    expect(parseStoredSpacing('"1"')).toBeNull(); // a JSON string, not a number
    expect(parseStoredSpacing("null")).toBeNull();
    expect(parseStoredSpacing("not json")).toBeNull();
  });
});
