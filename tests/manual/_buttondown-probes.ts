// Shared probe-sequence definition for the Buttondown manual tests.
//
// Both the recorder (buttondown-api-golds.test.ts) and the replayer
// (buttondown-replay.test.ts) import from this module so the sequence
// is defined exactly once. The underscore prefix and the lack of a
// `.test.ts` suffix keep vitest from collecting this file as a test.
//
// See docs/design-buttondown.md Appendix A for the canonical probe
// table this module implements.

import {
  ButtondownApiError,
  type ButtondownClient,
  type ButtondownSubscriber,
} from "@/server/buttondown";

// Username of the Buttondown newsletter every test-related
// operator action must resolve to. `assertTestNewsletter` calls
// `GET /v1/accounts/me`, which returns the single newsletter the
// API key writes to, and refuses to proceed unless its username
// matches — catches both wrong-account and wrong-newsletter-same-
// account key swaps in .env.prod.
export const EXPECTED_TEST_NEWSLETTER_USERNAME = "intentional-society-api-tests";

export const assertTestNewsletter = async (client: ButtondownClient): Promise<void> => {
  const account = await client.getAccount();
  if (account.username !== EXPECTED_TEST_NEWSLETTER_USERNAME) {
    throw new Error(
      `assertTestNewsletter: refusing to proceed. Key resolves to newsletter "${account.username}" (owner: ${account.email_address}), expected "${EXPECTED_TEST_NEWSLETTER_USERNAME}". Check BUTTONDOWN_TEST_API_KEY in .env.prod.`,
    );
  }
};

// Cross-probe state. Probe 01 (list-seeded) populates `seededByEmail`
// so later probes can look up ids without knowing them ahead of time.
// Probe 06 (create-fresh) stashes its result so the patch and delete
// probes (08-10, 12) can target it.
export type ProbeContext = {
  seededByEmail: Map<string, ButtondownSubscriber>;
  createdSubscriber: ButtondownSubscriber | null;
};

export type Probe = {
  name: string;
  run: (client: ButtondownClient, ctx: ProbeContext) => Promise<unknown>;
};

export type ProbeResult = {
  name: string;
  result: unknown;
};

// Email literals used by the probes. The first three positions in
// the generated seed are alice (1), bob (2), carol (3); the local
// part includes the position number to keep emails unique across
// the alphabet-twice naming scheme.
export const SEED_EMAILS = {
  alice: "alice.01@fixture.test",
  bob: "bob.02@fixture.test",
  carol: "carol.03@fixture.test",
} as const;

export const PROBE_CREATED_EMAIL = "probe-created@fixture.test";
export const PROBE_CREATED_EMAIL_RENAMED = "probe-created-renamed@fixture.test";
export const PROBE_MISSING_ID = "missing-subscriber-for-probe-04";
export const PROBE_MISSING_EMAIL = "nobody-here@fixture.test";

export const buildProbes = (): Probe[] => [
  {
    name: "01-list-seeded",
    run: async (client, ctx) => {
      const list = await client.listSubscribers();
      for (const sub of list) {
        ctx.seededByEmail.set(sub.email_address.toLowerCase(), sub);
      }
      return list;
    },
  },
  {
    name: "02-get-by-id",
    run: async (client, ctx) => {
      const alice = ctx.seededByEmail.get(SEED_EMAILS.alice);
      if (!alice) throw new Error("probe 02: alice missing from seed");
      return client.getSubscriber(alice.id);
    },
  },
  {
    name: "03-get-by-email",
    run: async (client) => client.getSubscriber(SEED_EMAILS.alice),
  },
  {
    name: "04-get-missing-id",
    run: async (client) => client.getSubscriber(PROBE_MISSING_ID),
  },
  {
    name: "05-get-missing-email",
    run: async (client) => client.getSubscriber(PROBE_MISSING_EMAIL),
  },
  {
    name: "06-create-fresh",
    run: async (client, ctx) => {
      const result = await client.createSubscriber({
        email_address: PROBE_CREATED_EMAIL,
        tags: ["probe-fresh"],
        type: "regular",
      });
      if (!("dryRun" in result)) ctx.createdSubscriber = result;
      return result;
    },
  },
  {
    name: "07-create-duplicate",
    run: async (client) =>
      client.createSubscriber({
        email_address: PROBE_CREATED_EMAIL,
        tags: ["probe-dup-attempt"],
        type: "regular",
      }),
  },
  {
    name: "08-patch-tags",
    run: async (client, ctx) => {
      if (!ctx.createdSubscriber) throw new Error("probe 08: createdSubscriber missing");
      return client.updateSubscriber(ctx.createdSubscriber.id, {
        tags: ["probe-patched-tags"],
      });
    },
  },
  {
    name: "09-patch-email",
    run: async (client, ctx) => {
      if (!ctx.createdSubscriber) throw new Error("probe 09: createdSubscriber missing");
      return client.updateSubscriber(ctx.createdSubscriber.id, {
        email_address: PROBE_CREATED_EMAIL_RENAMED,
      });
    },
  },
  {
    name: "10-patch-both",
    run: async (client, ctx) => {
      if (!ctx.createdSubscriber) throw new Error("probe 10: createdSubscriber missing");
      return client.updateSubscriber(ctx.createdSubscriber.id, {
        tags: ["probe-patched-tags", "probe-extra"],
        email_address: PROBE_CREATED_EMAIL_RENAMED,
      });
    },
  },
  {
    name: "11-list-after-mutations",
    run: async (client) => client.listSubscribers(),
  },
  {
    name: "12-delete",
    run: async (client, ctx) => {
      if (!ctx.createdSubscriber) throw new Error("probe 12: createdSubscriber missing");
      return client.deleteSubscriber(ctx.createdSubscriber.id);
    },
  },
];

// Driver. Both record and replay walk the probe list through this so
// error capture and void-handling stay identical across worlds.
// Errors of type ButtondownApiError are captured as a value in the
// result stream; any other error propagates and aborts the run.
export const runProbeSequence = async (client: ButtondownClient): Promise<ProbeResult[]> => {
  const ctx: ProbeContext = { seededByEmail: new Map(), createdSubscriber: null };
  const results: ProbeResult[] = [];
  for (const probe of buildProbes()) {
    try {
      const raw = await probe.run(client, ctx);
      results.push({ name: probe.name, result: raw === undefined ? { __void: true } : raw });
    } catch (err) {
      if (err instanceof ButtondownApiError) {
        results.push({
          name: probe.name,
          result: { __error: { name: err.name, status: err.status, message: err.message } },
        });
      } else {
        throw err;
      }
    }
  }
  return results;
};
