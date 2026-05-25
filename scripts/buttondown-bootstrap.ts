/**
 * One-shot bootstrap reconciliation for the Buttondown sync rollout.
 *
 * See docs/design-buttondown.md → "Initial bootstrap reconciliation"
 * for the full design. Briefly:
 *
 *   - The CSV importer parked ~46 members in profile_programs based on
 *     Google Form data, but Buttondown's tag state has moved on since
 *     and is the more authoritative record for "is this person still
 *     opted in to this program."
 *   - This script walks every saved profile, reads its Buttondown
 *     subscriber, and reconciles the APP side to match (calling
 *     leaveProgram where Buttondown disagrees). It then issues a
 *     single full-overwrite PATCH per active subscriber to lock in
 *     the canonical tag set, clearing legacy tags like `active`.
 *
 * USAGE
 *   Dry run (default — no writes anywhere):
 *     npx tsx scripts/buttondown-bootstrap.ts
 *
 *   Apply for real (mutates the app DB and writes to Buttondown):
 *     npx tsx scripts/buttondown-bootstrap.ts --write
 *
 * ENV (from .env.local in dev, .env.prod via --prod in production):
 *   BUTTONDOWN_API_KEY                              required to talk to Buttondown
 *   DATABASE_URL                                    the app DB
 *   NEXT_PUBLIC_SUPABASE_URL                        loaded via transitive imports
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY    loaded via transitive imports
 *
 * Note on the dynamic imports inside main(): src/server modules
 * transitively pull src/lib/supabase/env.ts, which throws at module
 * load if Supabase env vars are unset. Loading dotenv first and
 * dynamic-importing the app modules afterward keeps the import-time
 * env check happening AFTER .env.* is in place.
 */

import { createInterface } from "node:readline/promises";
import { config } from "dotenv";

const argv = process.argv.slice(2);
const useProd = argv.includes("--prod");
const write = argv.includes("--write");

const confirmIfWrite = async (): Promise<void> => {
  if (!write) return;
  const target = useProd ? "PRODUCTION" : "local";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`About to mutate ${target} state (app DB + Buttondown). Type "yes" to continue: `);
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.error("Aborted.");
    process.exit(1);
  }
};

async function main() {
  config({ path: useProd ? ".env.prod" : ".env.local" });

  if (!process.env.BUTTONDOWN_API_KEY) {
    console.error("BUTTONDOWN_API_KEY is not set in the loaded env file.");
    process.exit(1);
  }

  await confirmIfWrite();

  // Dynamic imports: see header note. Static imports would evaluate
  // src/lib/supabase/env.ts before config() loaded .env, throwing
  // before this script could even check its own env precondition.
  const { createButtondownClient } = await import("../src/server/buttondown");
  const {
    applyBootstrapForMember,
    loadBootstrapMembers,
    loadJoinedTaggedPrograms,
    loadManagedUniverse,
  } = await import("../src/server/buttondown-bootstrap");
  const { buildSubscriberLookup } = await import("../src/server/buttondown-sync");

  const client = createButtondownClient({
    apiKey: process.env.BUTTONDOWN_API_KEY,
    write,
  });

  console.log(`# Buttondown bootstrap — ${write ? "WRITE" : "dry-run"} mode (${useProd ? "prod" : "local"})`);

  const [members, byProfile, managedUniverse] = await Promise.all([
    loadBootstrapMembers(),
    loadJoinedTaggedPrograms(),
    loadManagedUniverse(),
  ]);

  // Preload the audience once via listSubscribers and index it. The
  // bootstrap is a broad run (every member), so the same per-member
  // lookup the cron uses applies here — turning N×(1-2) GETs into
  // ceil(N_subscribers/100) paginated calls.
  console.log(`# Preloading Buttondown audience…`);
  const lookup = await buildSubscriberLookup(client, undefined);

  console.log(`# ${members.length} saved profiles; managed tag universe: [${[...managedUniverse].join(", ")}]\n`);

  const counts = {
    reconciled: 0,
    skippedMissingEmail: 0,
    skippedMissingSubscriber: 0,
    skippedUnsubscribed: 0,
    errors: 0,
  };

  for (const member of members) {
    const label = `${member.displayName ?? "(no name)"} <${member.email ?? "(no email)"}>`;
    try {
      const joined = byProfile.get(member.profileId) ?? [];
      const { plan, applied } = await applyBootstrapForMember(member, joined, managedUniverse, { client, lookup, write });

      switch (plan.kind) {
        case "skip-missing-email":
          counts.skippedMissingEmail++;
          console.log(`SKIP missing-email   ${label}`);
          break;
        case "skip-missing-subscriber":
          counts.skippedMissingSubscriber++;
          console.log(`SKIP missing-sub     ${label}  (tried: ${plan.tried.join(", ")})`);
          break;
        case "skip-unsubscribed":
          counts.skippedUnsubscribed++;
          console.log(`SKIP unsubscribed    ${label}  (subscriber ${plan.subscriberId})`);
          break;
        case "reconcile": {
          counts.reconciled++;
          const leaveSummary =
            plan.programsToLeave.length === 0
              ? "no app-side leaves"
              : `leaveProgram: ${plan.programsToLeave.map((p) => p.programSlug).join(", ")}`;
          console.log(
            `${applied ? "APPLY" : "PLAN "} reconcile        ${label}  (${leaveSummary}; final tags: [${plan.finalTags.join(", ")}])`,
          );
          break;
        }
      }
    } catch (err) {
      counts.errors++;
      console.log(`ERROR                ${label}  ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n# Summary: ${JSON.stringify(counts)}`);
  console.log(write ? "# Wrote changes." : "# Dry-run only — no changes made. Re-run with --write to apply.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
