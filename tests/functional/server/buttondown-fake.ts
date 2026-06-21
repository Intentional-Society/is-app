// In-memory fake Buttondown server for tests.
//
// Satisfies the ButtondownClient interface defined in
// src/server/buttondown.ts. Tests seed an initial audience via
// `initialSubscribers`, run the code under test, and then assert
// against:
//   - `effects` — the ordered list of mutation attempts (create /
//     update), tagged with whether they were dry-run.
//   - `subscribers` — the post-mutation in-memory store.
//
// The fake honors the same write/dry-run semantics as the real
// client: mutations are recorded as effects regardless, but only
// actually mutate the store when constructed with write=true.
//
// Lives under tests/ rather than src/ because it's test-only
// infrastructure. The shape mirrors src/server/buttondown.ts's
// public surface and the two files are kept in sync by hand.

import {
  type ButtondownAccount,
  ButtondownApiError,
  type ButtondownClient,
  type ButtondownSubscriber,
  type CreateSubscriberInput,
  type DryRunOutcome,
  type UpdateSubscriberInput,
} from "@/server/buttondown";

// Default account identity the fake reports from getAccount(). The
// username matches what the real api-tests key resolves to, so
// assertTestNewsletter passes during replay without per-test setup.
const DEFAULT_FAKE_ACCOUNT: ButtondownAccount = {
  username: "intentional-society-api-tests",
};

export type FakeButtondownConfig = {
  write: boolean;
  initialSubscribers?: ButtondownSubscriber[];
  // Override the fake's account identity. Defaults to an api-tests
  // shape so the sanity check passes. Pass a mismatched username
  // to exercise the failure path.
  account?: ButtondownAccount;
};

export type FakeButtondownEffect =
  | { kind: "create"; input: CreateSubscriberInput; dryRun: boolean }
  | { kind: "update"; id: string; patch: UpdateSubscriberInput; dryRun: boolean }
  | { kind: "delete"; id: string; dryRun: boolean };

export type FakeButtondownClient = ButtondownClient & {
  effects: FakeButtondownEffect[];
  subscribers: Map<string, ButtondownSubscriber>;
};

let fakeIdCounter = 0;
const nextFakeId = () => `fakesub_${++fakeIdCounter}`;

// Real Buttondown returns each subscriber's `tags` array sorted
// ascending by tag name, regardless of the order the tags were
// supplied in. The fake mirrors that so consumers don't accidentally
// depend on insertion order — code that works against the fake will
// then keep working against the real API.
const sortTags = (tags: string[]): string[] => [...tags].sort();

export const createFakeButtondownClient = (config: FakeButtondownConfig = { write: true }): FakeButtondownClient => {
  const subscribers = new Map<string, ButtondownSubscriber>();
  for (const s of config.initialSubscribers ?? []) {
    // Real Buttondown always returns `metadata` as an object — a
    // metadata-less subscriber comes back as `{}`, not absent (confirmed
    // by the re-recorded golds, Appendix A). Normalize seeds to match so
    // the fake's reads deep-equal the real ones.
    subscribers.set(s.id, { ...s, tags: sortTags(s.tags), metadata: { ...(s.metadata ?? {}) } });
  }
  const account: ButtondownAccount = { ...(config.account ?? DEFAULT_FAKE_ACCOUNT) };
  const effects: FakeButtondownEffect[] = [];

  const findByEmail = (email: string): ButtondownSubscriber | undefined => {
    const lower = email.toLowerCase();
    for (const s of subscribers.values()) {
      if (s.email_address.toLowerCase() === lower) return s;
    }
    return undefined;
  };

  return {
    effects,
    subscribers,

    async listSubscribers() {
      // Snapshot — callers shouldn't see in-flight mutations during a
      // single iteration, so we return a copy of the values.
      return Array.from(subscribers.values()).map((s) => ({
        ...s,
        tags: [...s.tags],
        metadata: { ...(s.metadata ?? {}) },
      }));
    },

    async getAccount() {
      return { ...account };
    },

    async getSubscriber(idOrEmail) {
      const byId = subscribers.get(idOrEmail);
      if (byId) return byId;
      return findByEmail(idOrEmail) ?? null;
    },

    async createSubscriber(input: CreateSubscriberInput): Promise<ButtondownSubscriber | DryRunOutcome<"create">> {
      effects.push({ kind: "create", input, dryRun: !config.write });
      if (!config.write) {
        return { dryRun: true, intent: "create", payload: input };
      }
      if (findByEmail(input.email_address)) {
        // Real Buttondown returns 400 email_already_exists for a
        // duplicate create — see probe 10's gold. Match the status;
        // the message text is whatever, since replay compares {name,
        // status} only.
        throw new ButtondownApiError(400, "fake: duplicate email");
      }
      const sub: ButtondownSubscriber = {
        id: nextFakeId(),
        email_address: input.email_address,
        type: "regular",
        tags: sortTags(input.tags),
        // Absent input metadata materializes as `{}`, mirroring real
        // Buttondown's create response (Appendix A golds).
        metadata: { ...(input.metadata ?? {}) },
      };
      subscribers.set(sub.id, sub);
      return { ...sub, metadata: { ...sub.metadata } };
    },

    async updateSubscriber(
      id: string,
      patch: UpdateSubscriberInput,
    ): Promise<ButtondownSubscriber | DryRunOutcome<"update">> {
      effects.push({ kind: "update", id, patch, dryRun: !config.write });
      if (!config.write) {
        return { dryRun: true, intent: "update", payload: { id, patch } };
      }
      const sub = subscribers.get(id);
      if (!sub) throw new ButtondownApiError(404, "fake: subscriber not found");
      if (patch.email_address !== undefined && findByEmail(patch.email_address) !== undefined) {
        // Real Buttondown rejects PATCH email_address when any
        // subscriber (including the one being patched) already has
        // that email — so PATCHing to the value the row currently
        // holds is itself a 400, not a no-op. Probe 13 documents
        // this wire surprise.
        throw new ButtondownApiError(400, "fake: email already in use");
      }
      const updated: ButtondownSubscriber = {
        ...sub,
        ...(patch.email_address !== undefined ? { email_address: patch.email_address } : {}),
        ...(patch.tags !== undefined ? { tags: sortTags(patch.tags) } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        // Whole-blob replace: a PATCH carrying `metadata` sets the
        // entire object, dropping any key not in the new blob — probe 20
        // confirms Buttondown replaces rather than server-side merges.
        // The sync only ever sends a full merged blob (`{ ...existing,
        // name }`), so other keys survive every production write.
        ...(patch.metadata !== undefined ? { metadata: { ...patch.metadata } } : {}),
      };
      subscribers.set(id, updated);
      return { ...updated, metadata: { ...(updated.metadata ?? {}) } };
    },

    async deleteSubscriber(id: string): Promise<undefined | DryRunOutcome<"delete">> {
      effects.push({ kind: "delete", id, dryRun: !config.write });
      if (!config.write) {
        return { dryRun: true, intent: "delete", payload: { id } };
      }
      if (!subscribers.has(id)) {
        throw new ButtondownApiError(404, "fake: subscriber not found");
      }
      subscribers.delete(id);
    },
  };
};
