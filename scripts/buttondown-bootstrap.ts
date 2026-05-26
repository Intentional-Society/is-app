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
 *   SUPABASE_SECRET_KEY                             loaded via transitive imports
 *                                                   (src/lib/supabase/admin.ts throws at
 *                                                   module load if unset)
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
    loadProgramsByTag,
  } = await import("../src/server/buttondown-bootstrap");
  const { buildSubscriberLookup } = await import("../src/server/buttondown-sync");

  // The bootstrap never writes to Buttondown — the client is only
  // used to read the audience for the subscriber lookup, so the
  // write flag stays false regardless of the script's --write mode.
  const client = createButtondownClient({
    apiKey: process.env.BUTTONDOWN_API_KEY,
    write: false,
  });

  console.log(`# Buttondown bootstrap — ${write ? "WRITE" : "dry-run"} mode (${useProd ? "prod" : "local"})`);

  const [members, byProfile, programsByTag] = await Promise.all([
    loadBootstrapMembers(),
    loadJoinedTaggedPrograms(),
    loadProgramsByTag(),
  ]);

  // Preload the audience once via listSubscribers and index it. The
  // bootstrap is a broad run (every member), so the same per-member
  // lookup the cron uses applies here — turning N×(1-2) GETs into
  // ceil(N_subscribers/100) paginated calls.
  console.log(`# Preloading Buttondown audience…`);
  const lookup = await buildSubscriberLookup(client, undefined);

  console.log(`# ${members.length} app members; managed tag universe: [${[...programsByTag.keys()].join(", ")}]\n`);

  const counts = {
    reconciled: 0,
    skippedMissingEmail: 0,
    skippedMissingSubscriber: 0,
    skippedUnsubscribed: 0,
    skippedNoChanges: 0,
    noIswebMember: 0,
    errors: 0,
  };

  for (const member of members) {
    const label = `${member.displayName ?? "(no name)"} <${member.email ?? "(no email)"}>`;
    try {
      const joined = byProfile.get(member.profileId) ?? [];
      const { plan, applied } = await applyBootstrapForMember(member, joined, programsByTag, { lookup, write });

      switch (plan.kind) {
        case "skip-missing-email":
          counts.skippedMissingEmail++;
          console.log(`SKIP  missing-email     ${label}`);
          break;
        case "skip-missing-subscriber":
          counts.skippedMissingSubscriber++;
          console.log(`SKIP  missing-sub       ${label}  (tried: ${plan.tried.join(", ")})`);
          break;
        case "skip-unsubscribed":
          counts.skippedUnsubscribed++;
          console.log(`SKIP  unsubscribed      ${label}  (subscriber ${plan.subscriberId})`);
          break;
        case "skip-no-isweb-member":
          // Counted separately from `errors` (which is reserved for
          // thrown exceptions) but logged with an ERROR prefix so it
          // stands out for human review. Subscriber exists but doesn't
          // carry our `isweb-member` marker — likely an email collision
          // with a non-member newsletter subscriber.
          counts.noIswebMember++;
          console.log(
            `ERROR no-isweb-member   ${label}  (subscriber ${plan.subscriberId}; current tags: [${plan.currentTags.join(", ")}])`,
          );
          break;
        case "skip-no-changes":
          counts.skippedNoChanges++;
          console.log(`SKIP  no-changes        ${label}  (subscriber ${plan.subscriberId})`);
          break;
        case "reconcile": {
          counts.reconciled++;
          const leaveSummary =
            plan.programsToLeave.length === 0 ? "none" : plan.programsToLeave.map((p) => p.programSlug).join(", ");
          const joinSummary =
            plan.programsToJoin.length === 0 ? "none" : plan.programsToJoin.map((p) => p.programSlug).join(", ");
          // joinProgram is currently observation-only: planBootstrap
          // emits programsToJoin so the operator can size the
          // Apps-Script-era-tags-the-app-missed case before deciding
          // whether to wire up an actual join path.
          console.log(
            `${applied ? "APPLY" : "PLAN "} reconcile         ${label}  (leave: ${leaveSummary}; join (obs only): ${joinSummary})`,
          );
          break;
        }
      }
    } catch (err) {
      counts.errors++;
      console.log(`ERROR                   ${label}  ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n# Summary: ${JSON.stringify(counts)}`);
  console.log(write ? "# Wrote changes." : "# Dry-run only — no changes made. Re-run with --write to apply.");
}

// process.exit forces termination: the script imports src/server/db,
// which opens a postgres-js pool at module load. Without an explicit
// exit, Node won't terminate until the pool's idle TCP sockets time
// out, which leaves the script hanging long after the summary prints.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
