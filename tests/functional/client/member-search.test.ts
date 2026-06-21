import { describe, expect, it } from "vitest";

import type { MemberSummary } from "@/lib/api-types";
import { scoreMember } from "@/lib/member-search";

// Only the fields member-search reads matter; cast a partial to the full shape.
const member = (displayName: string | null, extra: Partial<MemberSummary> = {}): MemberSummary =>
  ({ displayName, location: null, keywords: [], ...extra }) as MemberSummary;

describe("scoreMember", () => {
  it("finds a parenthetical nickname mid-name (#409)", () => {
    const m = member("Bob (Benya) Smith");
    expect(scoreMember(m, "benya")).toBeGreaterThan(0);
    expect(scoreMember(m, "beny")).toBeGreaterThan(0);
  });

  it("still matches the leading name and the surname", () => {
    const m = member("Bob (Benya) Smith");
    expect(scoreMember(m, "bob")).toBeGreaterThan(0);
    expect(scoreMember(m, "smith")).toBeGreaterThan(0);
  });

  it("matches a name that simply starts with the query", () => {
    expect(scoreMember(member("Benyamin Bok"), "benya")).toBeGreaterThan(0);
  });

  it("still matches location and interest keywords", () => {
    const m = member("Aria Chen", { location: "Lisbon", keywords: ["pottery"] });
    expect(scoreMember(m, "lisbon")).toBeGreaterThan(0);
    expect(scoreMember(m, "pottery")).toBeGreaterThan(0);
  });

  it("rejects a query that matches no name word, keyword, or location", () => {
    expect(scoreMember(member("Bob (Benya) Smith"), "zzzzz")).toBe(0);
  });

  it("handles a null display name without throwing", () => {
    expect(scoreMember(member(null), "anything")).toBe(0);
  });
});
