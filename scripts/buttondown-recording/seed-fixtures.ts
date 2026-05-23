/**
 * Wipe + reseed the api-tests Buttondown newsletter.
 *
 * USAGE
 *   npm run special:buttondown:seed-fixtures              # writes
 *   npm run special:buttondown:seed-fixtures -- --dry-run # no writes
 *
 * Reads tests/functional/server/__data__/buttondown/fixtures/seed.json,
 * deletes every current subscriber on the test newsletter, then creates
 * one subscriber per entry with the tags listed there.
 *
 * SAFETY
 *   Buttondown API keys are scoped per-newsletter, so the worst case
 *   if the wrong key is in .env.prod is "you wipe the wrong newsletter
 *   that this key happens to own" — the key cannot reach anyone else's
 *   audience. The script prints the key fingerprint at the top so you
 *   can eyeball it before pressing yes.
 *
 * ENV (read from .env.prod at the project root)
 *   BUTTONDOWN_TEST_API_KEY  — the test-newsletter key. See
 *   docs/design-buttondown.md Appendix A.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import { createButtondownClient, isDryRunOutcome } from "@/server/buttondown";

import { assertTestNewsletter } from "../../tests/manual/_buttondown-probes";

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

type SeedEntry = { email_address: string; tags: string[] };

const main = async (): Promise<void> => {
  loadEnv({ path: resolve(PROJECT_ROOT, ".env.prod"), quiet: true });

  const isDryRun = process.argv.slice(2).includes("--dry-run");

  const apiKey = process.env.BUTTONDOWN_TEST_API_KEY ?? "";
  if (!apiKey) {
    console.error("BUTTONDOWN_TEST_API_KEY missing from .env.prod. Aborting.");
    process.exit(1);
  }

  const fingerprint = `${apiKey.slice(0, 3)}...${apiKey.slice(-3)}`;
  console.log(`Key:    ${fingerprint}`);
  console.log(`Seed:   ${SEED_PATH}`);
  console.log(`Mode:   ${isDryRun ? "DRY RUN — nothing will be written" : "LIVE — wipe + reseed"}\n`);

  const seed = JSON.parse(readFileSync(SEED_PATH, "utf8")) as SeedEntry[];
  console.log(`Loaded ${seed.length} entries from seed.json:`);
  for (const entry of seed) {
    console.log(`  ${entry.email_address}  [${entry.tags.join(", ")}]`);
  }
  console.log();

  const client = createButtondownClient({ apiKey, write: !isDryRun });

  console.log("Verifying the key resolves to the expected newsletter...");
  await assertTestNewsletter(client);
  console.log("  ok.\n");

  if (!isDryRun) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      'This wipes every subscriber on the test newsletter, then recreates from seed.json. Type "yes" to proceed: ',
    );
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      console.error("Aborted.");
      process.exit(1);
    }
    console.log();
  }

  console.log("Listing current subscribers...");
  const existing = await client.listSubscribers();
  console.log(`  ${existing.length} currently present.\n`);

  for (const sub of existing) {
    console.log(`  delete  ${sub.email_address}  (id=${sub.id})`);
    const result = await client.deleteSubscriber(sub.id);
    if (isDryRunOutcome(result)) console.log("    [dry-run — no API call]");
  }

  console.log("\nCreating from seed.json...");
  for (const entry of seed) {
    console.log(`  create  ${entry.email_address}  [${entry.tags.join(", ")}]`);
    const result = await client.createSubscriber({
      email_address: entry.email_address,
      tags: entry.tags,
    });
    if (isDryRunOutcome(result)) {
      console.log("    [dry-run — no API call]");
    } else {
      console.log(`    → id ${result.id}`);
    }
  }

  console.log("\nDone.");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
