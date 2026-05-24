/**
 * Emit the canonical fixture audience as JSON.
 *
 * USAGE
 *   npm run special:buttondown:generate-seed
 *
 * Writes tests/functional/server/__data__/buttondown/fixtures/seed.json.
 * Re-running produces the same output. The hand-picked position arrays
 * below ARE the distribution spec — change them here, regenerate, and
 * the seed file follows.
 *
 * NAMING
 *   Local part of each email is a first name followed by a 2-digit
 *   position number (e.g., alice.01@fixture.test). Names cycle A-Z
 *   twice, then 8 retired Atlantic hurricane names.
 *
 * DISTRIBUTION (60 subscribers, all @fixture.test)
 *   48 members  (have "tisweb-member"), 12 non-members. Non-members
 *   are sprinkled throughout the position range, not bunched at the
 *   end. Member tag distribution is lumpy by design — a long tail of
 *   single-tag lurkers and a small cluster of all-five super-engaged
 *   members alongside the middle ground.
 *
 *   Member roles (48 total):
 *     7 lurkers      [tisweb-member]
 *     8 two-tag      [tisweb-member, tweekly-web-updates]
 *    17 three-tag    [tisweb, tweekly, + one of c/a/p]   (11 c, 1 a, 5 p)
 *    11 four-tag     [tisweb, tweekly, + two of c/a/p]   (4 ca, 5 cp, 2 ap)
 *     5 super        all five tags
 *
 *   Non-member roles (12 total):
 *     6 active       [tactive]
 *     6 untagged     []
 *
 *   Two of the 60 are marked `unsubscribed: true` so seed-fixtures
 *   applies a PATCH after creation (the only documented way to put a
 *   subscriber into "unsubscribed" state via the API). One is a
 *   super-tagged member (frank.06), one is an untagged non-member
 *   (dave.04) — together they cover both branches the sync code
 *   takes when it encounters subscriber.type === "unsubscribed".
 *
 *   Resulting tag counts:
 *     tisweb-member       48   (80% of 60)
 *     tweekly-web-updates 41   (85% of 48)
 *     tcommunity-calls    25
 *     tarts-in-is         12
 *     tpod-program        17
 *     tactive              6
 *
 * Tag names start with "t" so they're recognisable as test data even
 * when grepped in isolation, without colliding with the real prod
 * tag namespace.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..");
const SEED_PATH = resolve(
  PROJECT_ROOT,
  "tests",
  "functional",
  "server",
  "__data__",
  "buttondown",
  "fixtures",
  "seed.json",
);

// 60 unique first names in fixed order. Indexes 1..26 are A-Z
// (alphabet 1); 27..52 are a second A-Z pass; 53..60 are eight
// retired Atlantic hurricane names.
const NAMES: readonly string[] = [
  // Alphabet 1 (1..26)
  "alice", "bob", "carol", "dave", "eve", "frank", "gina", "henry", "ivy", "jack",
  "kate", "leo", "mary", "nick", "olivia", "paul", "quinn", "rachel", "steve", "tara",
  "uma", "victor", "wendy", "xavier", "yara", "zach",
  // Alphabet 2 (27..52)
  "alex", "ben", "claire", "dan", "ella", "fred", "grace", "harry", "irene", "james",
  "kelly", "liam", "maya", "noah", "oscar", "penny", "quentin", "riley", "sam", "tina",
  "ulysses", "vera", "will", "xena", "yvonne", "zoe",
  // Hurricanes (53..60)
  "andrew", "camille", "floyd", "hugo", "ian", "katrina", "maria", "sandy",
];

// Every position 1..60 belongs to exactly one role. The role
// determines the tag set on that position's subscriber. The arrays
// here ARE the distribution; rebalance by moving positions between
// arrays and rerunning.

// Members (48 total)
const LURKER_POSITIONS = new Set([3, 10, 25, 35, 43, 49, 59]);                              // 7
const TWO_TAG_POSITIONS = new Set([2, 7, 15, 20, 29, 37, 47, 55]);                          // 8
const THREE_TAG_C_POSITIONS = new Set([1, 5, 14, 18, 22, 27, 34, 40, 44, 51, 58]);          // 11
const THREE_TAG_A_POSITIONS = new Set([12]);                                                // 1
const THREE_TAG_P_POSITIONS = new Set([9, 16, 32, 46, 52]);                                 // 5
const FOUR_TAG_CA_POSITIONS = new Set([8, 24, 36, 48]);                                     // 4
const FOUR_TAG_CP_POSITIONS = new Set([13, 21, 30, 41, 53]);                                // 5
const FOUR_TAG_AP_POSITIONS = new Set([26, 38]);                                            // 2
const SUPER_POSITIONS = new Set([6, 19, 31, 42, 56]);                                       // 5

// Non-members (12 total) — sprinkled, not bunched at the end.
const NONMEMBER_ACTIVE_POSITIONS = new Set([11, 23, 28, 39, 50, 57]);                       // 6
const NONMEMBER_UNTAGGED_POSITIONS = new Set([4, 17, 33, 45, 54, 60]);                      // 6

// Positions that the seed-fixtures script should PATCH to
// type:"unsubscribed" after creation. Chosen for sync-branch
// coverage: a heavily-tagged member and an untagged non-member.
const UNSUBSCRIBED_POSITIONS = new Set([
  6,  // frank.06 — super (all 5 tags)
  4,  // dave.04  — untagged non-member
]);

const ALL_ROLE_SETS: { name: string; positions: Set<number> }[] = [
  { name: "lurker", positions: LURKER_POSITIONS },
  { name: "2-tag", positions: TWO_TAG_POSITIONS },
  { name: "3-tag-c", positions: THREE_TAG_C_POSITIONS },
  { name: "3-tag-a", positions: THREE_TAG_A_POSITIONS },
  { name: "3-tag-p", positions: THREE_TAG_P_POSITIONS },
  { name: "4-tag-ca", positions: FOUR_TAG_CA_POSITIONS },
  { name: "4-tag-cp", positions: FOUR_TAG_CP_POSITIONS },
  { name: "4-tag-ap", positions: FOUR_TAG_AP_POSITIONS },
  { name: "super", positions: SUPER_POSITIONS },
  { name: "nonmember-active", positions: NONMEMBER_ACTIVE_POSITIONS },
  { name: "nonmember-untagged", positions: NONMEMBER_UNTAGGED_POSITIONS },
];

const tagsForPosition = (pos: number): string[] => {
  if (LURKER_POSITIONS.has(pos)) return ["tisweb-member"];
  if (TWO_TAG_POSITIONS.has(pos)) return ["tisweb-member", "tweekly-web-updates"];
  if (THREE_TAG_C_POSITIONS.has(pos)) return ["tisweb-member", "tweekly-web-updates", "tcommunity-calls"];
  if (THREE_TAG_A_POSITIONS.has(pos)) return ["tisweb-member", "tweekly-web-updates", "tarts-in-is"];
  if (THREE_TAG_P_POSITIONS.has(pos)) return ["tisweb-member", "tweekly-web-updates", "tpod-program"];
  if (FOUR_TAG_CA_POSITIONS.has(pos))
    return ["tisweb-member", "tweekly-web-updates", "tcommunity-calls", "tarts-in-is"];
  if (FOUR_TAG_CP_POSITIONS.has(pos))
    return ["tisweb-member", "tweekly-web-updates", "tcommunity-calls", "tpod-program"];
  if (FOUR_TAG_AP_POSITIONS.has(pos))
    return ["tisweb-member", "tweekly-web-updates", "tarts-in-is", "tpod-program"];
  if (SUPER_POSITIONS.has(pos))
    return ["tisweb-member", "tweekly-web-updates", "tcommunity-calls", "tarts-in-is", "tpod-program"];
  if (NONMEMBER_ACTIVE_POSITIONS.has(pos)) return ["tactive"];
  if (NONMEMBER_UNTAGGED_POSITIONS.has(pos)) return [];
  throw new Error(`generate-seed: position ${pos} has no role assignment`);
};

// Sanity: every position 1..60 assigned exactly once.
const seen = new Set<number>();
for (const { name, positions } of ALL_ROLE_SETS) {
  for (const pos of positions) {
    if (seen.has(pos)) throw new Error(`generate-seed: position ${pos} assigned to multiple roles (last: ${name})`);
    if (pos < 1 || pos > 60) throw new Error(`generate-seed: position ${pos} out of 1..60 range (role ${name})`);
    seen.add(pos);
  }
}
if (seen.size !== 60) throw new Error(`generate-seed: expected all 60 positions assigned, got ${seen.size}`);
if (NAMES.length !== 60) throw new Error(`generate-seed: NAMES must have 60 entries, got ${NAMES.length}`);

type SeedEntry = { email_address: string; tags: string[]; unsubscribed?: true };

const seed: SeedEntry[] = [];
for (let pos = 1; pos <= 60; pos++) {
  const local = `${NAMES[pos - 1]}.${String(pos).padStart(2, "0")}`;
  const entry: SeedEntry = { email_address: `${local}@fixture.test`, tags: tagsForPosition(pos) };
  if (UNSUBSCRIBED_POSITIONS.has(pos)) entry.unsubscribed = true;
  seed.push(entry);
}

// One subscriber per line — easier to diff than fully-indented JSON.
const lines = seed.map((entry) => `  ${JSON.stringify(entry)}`);
writeFileSync(SEED_PATH, `[\n${lines.join(",\n")}\n]\n`);

// Quick summary for the operator.
const counts = {
  total: seed.length,
  "tisweb-member": seed.filter((e) => e.tags.includes("tisweb-member")).length,
  "tweekly-web-updates": seed.filter((e) => e.tags.includes("tweekly-web-updates")).length,
  "tcommunity-calls": seed.filter((e) => e.tags.includes("tcommunity-calls")).length,
  "tarts-in-is": seed.filter((e) => e.tags.includes("tarts-in-is")).length,
  "tpod-program": seed.filter((e) => e.tags.includes("tpod-program")).length,
  tactive: seed.filter((e) => e.tags.includes("tactive")).length,
  untagged: seed.filter((e) => e.tags.length === 0).length,
  unsubscribed: seed.filter((e) => e.unsubscribed === true).length,
};
const byTagCount = [0, 1, 2, 3, 4, 5].map((n) => ({
  [`${n}-tags`]: seed.filter((e) => e.tags.length === n).length,
}));
console.log(`Wrote ${SEED_PATH}`);
console.log(counts);
console.log("Subscribers by tag count:", Object.assign({}, ...byTagCount));
