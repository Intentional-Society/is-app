// Tests for the pure helpers in scripts/biome-precommit.mjs.
//
// Lives under tests/functional/server/ so vitest's node-env project picks
// it up. The functions tested are tooling helpers, not server code, but
// node-env is what they need and adding a separate vitest project just
// for one file isn't worth it.

import { describe, expect, it } from "vitest";

import { formatStatsLine, parseBiomeFixedCount } from "../../../scripts/biome-precommit.mjs";

describe("parseBiomeFixedCount", () => {
  it("returns 0 for the clean case", () => {
    expect(parseBiomeFixedCount("Checked 5 files in 9ms. No fixes applied.")).toBe(0);
  });

  it("returns 1 for the singular phrasing", () => {
    expect(parseBiomeFixedCount("Checked 1 file in 9ms. Fixed 1 file.")).toBe(1);
  });

  it("returns N for the plural phrasing", () => {
    expect(parseBiomeFixedCount("Checked 10 files in 9ms. Fixed 3 files.")).toBe(3);
  });

  it("returns 0 for unexpected output (regex no match)", () => {
    expect(parseBiomeFixedCount("something totally different")).toBe(0);
    expect(parseBiomeFixedCount("")).toBe(0);
  });

  it("returns 0 for non-string input (defensive)", () => {
    expect(parseBiomeFixedCount(undefined)).toBe(0);
    expect(parseBiomeFixedCount(null)).toBe(0);
  });
});

describe("formatStatsLine", () => {
  it("produces a JSONL line (trailing newline)", () => {
    const line = formatStatsLine({
      ts: "2026-05-28T12:00:00.000Z",
      files_input: 3,
      files_fixed: 1,
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("round-trips through JSON.parse", () => {
    const input = { ts: "2026-05-28T12:00:00.000Z", files_input: 3, files_fixed: 1 };
    const parsed = JSON.parse(formatStatsLine(input));
    expect(parsed).toEqual(input);
  });
});
