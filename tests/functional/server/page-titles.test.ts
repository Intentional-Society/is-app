import { describe, expect, it } from "vitest";

import { labelForPath, PAGE_TITLES, type PageTitle, titleFor } from "@/lib/page-titles";

describe("page-titles dictionary", () => {
  it("every entry has a non-empty title, and any crumb is non-empty too", () => {
    // `satisfies` narrows each entry to its literal shape, so widen back
    // to PageTitle to inspect the optional crumb uniformly.
    for (const [path, entry] of Object.entries(PAGE_TITLES) as [string, PageTitle][]) {
      expect(entry.title.trim(), `title for ${path}`).not.toBe("");
      if (entry.crumb !== undefined) {
        expect(entry.crumb.trim(), `crumb for ${path}`).not.toBe("");
      }
    }
  });

  it("titleFor returns the dictionary title", () => {
    expect(titleFor("/members")).toBe("Member directory");
    expect(titleFor("/admin/programs")).toBe("Admin · Programs");
  });
});

describe("labelForPath (breadcrumb back-link)", () => {
  it("special-cases the root as Home", () => {
    // Home keeps the brand as its document title, so it has no dictionary
    // entry; the back link still needs a short label.
    expect(labelForPath("/")).toBe("Home");
  });

  it("prefers a route's crumb over its title", () => {
    expect(labelForPath("/members")).toBe("Directory");
    expect(labelForPath("/admin/programs")).toBe("Admin programs");
  });

  it("falls back to the title when no crumb is set", () => {
    expect(labelForPath("/myweb")).toBe("My web");
  });

  it("labels dynamic detail pages with their parent section", () => {
    expect(labelForPath("/members/some-slug")).toBe("Member");
    expect(labelForPath("/programs/a-program")).toBe("Programs");
    expect(labelForPath("/admin/programs/123")).toBe("Admin programs");
  });

  it("returns a generic Back for unknown paths", () => {
    expect(labelForPath("/nowhere")).toBe("Back");
  });
});
