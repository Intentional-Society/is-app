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
  ButtondownApiError,
  type ButtondownClient,
  ButtondownConflictError,
  type ButtondownSubscriber,
  type CreateSubscriberInput,
  type DryRunOutcome,
  type UpdateSubscriberInput,
} from "@/server/buttondown";

export type FakeButtondownConfig = {
  write: boolean;
  initialSubscribers?: ButtondownSubscriber[];
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

export const createFakeButtondownClient = (config: FakeButtondownConfig = { write: true }): FakeButtondownClient => {
  const subscribers = new Map<string, ButtondownSubscriber>();
  for (const s of config.initialSubscribers ?? []) {
    subscribers.set(s.id, { ...s, tags: [...s.tags] });
  }
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
      return Array.from(subscribers.values()).map((s) => ({ ...s, tags: [...s.tags] }));
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
      if (findByEmail(input.email_address)) throw new ButtondownConflictError();
      const sub: ButtondownSubscriber = {
        id: nextFakeId(),
        email_address: input.email_address,
        type: "regular",
        tags: [...input.tags],
      };
      subscribers.set(sub.id, sub);
      return sub;
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
      const updated: ButtondownSubscriber = {
        ...sub,
        ...(patch.email_address !== undefined ? { email_address: patch.email_address } : {}),
        ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
      };
      subscribers.set(id, updated);
      return updated;
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
