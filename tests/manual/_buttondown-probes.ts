// Shared probe-sequence definition for the Buttondown manual tests.
//
// Both the recorder (buttondown-api-golds.test.ts) and the replayer
// (buttondown-replay.test.ts) import from this module so the sequence
// is defined exactly once. The underscore prefix and the lack of a
// `.test.ts` suffix keep vitest from collecting this file as a test.
//
// See docs/design-buttondown.md Appendix A for the canonical probe
// table this module implements.

import { ButtondownApiError, type ButtondownClient, type ButtondownSubscriber } from "@/server/buttondown";

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
      `assertTestNewsletter: refusing to proceed. Key resolves to newsletter "${account.username}", expected "${EXPECTED_TEST_NEWSLETTER_USERNAME}". Check BUTTONDOWN_TEST_API_KEY in .env.prod.`,
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

// Email literals used by the probes. Positions in the generated
// seed: alice (1), bob (2), carol (3), dave (4 — untagged
// unsubscribed non-member), frank (6 — super-tagged unsubscribed
// member), henry (8 — 4-tag member used as the unsubscribe-then-
// resubscribe target). The local part includes the position number
// to keep emails unique across the alphabet-twice naming scheme.
export const SEED_EMAILS = {
  alice: "alice.01@fixture.test",
  bob: "bob.02@fixture.test",
  carol: "carol.03@fixture.test",
  dave: "dave.04@fixture.test",
  frank: "frank.06@fixture.test",
  henry: "henry.08@fixture.test",
} as const;

export const PROBE_CREATED_EMAIL = "probe-created@fixture.test";
export const PROBE_CREATED_EMAIL_RENAMED = "probe-created-renamed@fixture.test";
export const PROBE_CREATED_EMAIL_FINAL = "probe-created-final@fixture.test";
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
    name: "02-get-account",
    run: async (client) => client.getAccount(),
  },
  {
    name: "03-get-by-id",
    run: async (client, ctx) => {
      const alice = ctx.seededByEmail.get(SEED_EMAILS.alice);
      if (!alice) throw new Error("probe 03: alice missing from seed");
      return client.getSubscriber(alice.id);
    },
  },
  {
    name: "04-get-by-email",
    run: async (client) => client.getSubscriber(SEED_EMAILS.alice),
  },
  {
    name: "05-get-missing-id",
    run: async (client) => client.getSubscriber(PROBE_MISSING_ID),
  },
  {
    name: "06-get-missing-email",
    run: async (client) => client.getSubscriber(PROBE_MISSING_EMAIL),
  },
  {
    name: "07-get-unsubscribed-member",
    run: async (client) => client.getSubscriber(SEED_EMAILS.frank),
  },
  {
    name: "08-get-unsubscribed-nonmember",
    run: async (client) => client.getSubscriber(SEED_EMAILS.dave),
  },
  {
    name: "09-create-fresh",
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
    name: "10-create-duplicate",
    run: async (client) =>
      client.createSubscriber({
        email_address: PROBE_CREATED_EMAIL,
        tags: ["probe-dup-attempt"],
        type: "regular",
      }),
  },
  {
    name: "11-patch-tags",
    run: async (client, ctx) => {
      if (!ctx.createdSubscriber) throw new Error("probe 11: createdSubscriber missing");
      return client.updateSubscriber(ctx.createdSubscriber.id, {
        tags: ["probe-patched-tags"],
      });
    },
  },
  {
    name: "12-patch-email",
    run: async (client, ctx) => {
      if (!ctx.createdSubscriber) throw new Error("probe 12: createdSubscriber missing");
      return client.updateSubscriber(ctx.createdSubscriber.id, {
        email_address: PROBE_CREATED_EMAIL_RENAMED,
      });
    },
  },
  {
    // Documents a wire-layer surprise: PATCH email_address to the
    // subscriber's CURRENT value returns 400 "email_already_exists".
    // Buttondown's email PATCH is not idempotent.
    name: "13-patch-both-same-email",
    run: async (client, ctx) => {
      if (!ctx.createdSubscriber) throw new Error("probe 13: createdSubscriber missing");
      return client.updateSubscriber(ctx.createdSubscriber.id, {
        tags: ["probe-patched-tags", "probe-extra"],
        email_address: PROBE_CREATED_EMAIL_RENAMED,
      });
    },
  },
  {
    // Happy-path patch-both: sends a NEW email value so Buttondown
    // accepts the change. Pairs with 13 — together they cover both
    // the success and the same-value-rejection cases.
    name: "14-patch-both-new-email",
    run: async (client, ctx) => {
      if (!ctx.createdSubscriber) throw new Error("probe 14: createdSubscriber missing");
      return client.updateSubscriber(ctx.createdSubscriber.id, {
        tags: ["probe-patched-tags", "probe-extra"],
        email_address: PROBE_CREATED_EMAIL_FINAL,
      });
    },
  },
  {
    name: "15-patch-existing-unsubscribe",
    run: async (client, ctx) => {
      const henry = ctx.seededByEmail.get(SEED_EMAILS.henry);
      if (!henry) throw new Error("probe 15: henry missing from seed");
      return client.updateSubscriber(henry.id, { type: "unsubscribed" });
    },
  },
  {
    name: "16-patch-existing-resubscribe",
    run: async (client, ctx) => {
      const henry = ctx.seededByEmail.get(SEED_EMAILS.henry);
      if (!henry) throw new Error("probe 16: henry missing from seed");
      return client.updateSubscriber(henry.id, { type: "regular" });
    },
  },
  {
    name: "17-list-after-mutations",
    run: async (client) => client.listSubscribers(),
  },
  {
    name: "18-delete-probe-created",
    run: async (client, ctx) => {
      if (!ctx.createdSubscriber) throw new Error("probe 18: createdSubscriber missing");
      return client.deleteSubscriber(ctx.createdSubscriber.id);
    },
  },
  {
    name: "19-delete-missing",
    run: async (client) => client.deleteSubscriber(PROBE_MISSING_ID),
  },
];

// Driver. Both record and replay walk the probe list through this so
// error capture and void-handling stay identical across worlds.
// Errors of type ButtondownApiError are captured as a value in the
// result stream; any other error propagates and aborts the run.
//
// err.message is omitted because it's a client-side construction
// (the throw site in buttondown.ts assembles "<METHOD> subscriber:
// <status> <body>"), not anything Buttondown returns — capturing it
// would put data in typed_result that has no counterpart in
// http_calls. Every piece (method, status, body) is in http_calls
// already, so the string is reconstructable when debugging.
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
          result: { __error: { name: err.name, status: err.status } },
        });
      } else {
        throw err;
      }
    }
  }
  return results;
};
