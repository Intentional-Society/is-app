import { readdirSync, readFileSync } from "node:fs";
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

// `drizzle-kit generate` emits DDL for the pgSchema("auth") reference in
// schema.ts: `schemaFilter`/`tablesFilter` only gate `pull` introspection, not
// `generate`, and there is no table-level `.existing()` marker yet (drizzle-orm
// #1305). auth.users is Supabase-managed, so any CREATE/ALTER/DROP against the
// auth schema would break or corrupt prod. The snapshot baseline tracks
// auth.users to keep `generate` clean; this guards a regenerate from
// re-introducing auth-schema DDL. See devjournal 2026-06-03.
describe("migration SQL (drizzle/*.sql)", () => {
  // The FK in 0000 is `ALTER TABLE "profiles" ... REFERENCES "auth"."users"`,
  // which targets "profiles" — not "auth" — so it won't false-positive.
  const authDdl = /(?:CREATE|ALTER|DROP) TABLE (?:IF (?:NOT )?EXISTS )?"auth"\./i;

  it("never emits DDL against the auth schema", () => {
    const offenders = readdirSync("drizzle")
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => authDdl.test(readFileSync(`drizzle/${f}`, "utf8")))
      .map(
        (f) =>
          `${f} emits CREATE/ALTER/DROP TABLE against the "auth" schema — it is Supabase-managed. ` +
          `Strip the stray statement; the snapshot baseline already tracks auth.users.`,
      );

    expect(offenders).toEqual([]);
  });
});
