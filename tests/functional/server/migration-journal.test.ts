import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Drizzle applies a migration only when its journal `when` exceeds the highest
// already-applied one (pg-core/dialect.js: `created_at < folderMillis`). A
// migration authored before a later one lands on main keeps an earlier `when`
// and is silently skipped on DBs already past it — no DDL, no error. Guard the
// invariant that prevents it: `when`s must strictly increase in idx order.
// See devjournal 2026-05-29.
type JournalEntry = { idx: number; when: number; tag: string };

describe("migration journal (drizzle/meta/_journal.json)", () => {
  it("orders migration timestamps strictly ascending", () => {
    const { entries } = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: JournalEntry[];
    };

    const ordered = [...entries].sort((a, b) => a.idx - b.idx);
    const violations: string[] = [];
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      if (cur.when <= prev.when) {
        violations.push(
          `${cur.tag} (when=${cur.when}) is not newer than ${prev.tag} (when=${prev.when}); ` +
            `bump its "when" in drizzle/meta/_journal.json above ${prev.when}.`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
