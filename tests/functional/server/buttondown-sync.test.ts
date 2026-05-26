import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ButtondownSubscriber } from "@/server/buttondown";
import {
  buildSubscriberLookup,
  runButtondownSync,
  type SyncLogEvent,
  type UnsubscribeAlert,
} from "@/server/buttondown-sync";
import { db } from "@/server/db";
import { profilePrograms, profiles, programs } from "@/server/schema";

import { createFakeButtondownClient, type FakeButtondownEffect } from "./buttondown-fake";

// Every test scopes runButtondownSync to its own profile ids via
// `scopeProfileIds`. Without that, parallel test files race on the
// shared dev DB: the reconciler picks up other workers' profiles,
// writes their `buttondownSubscriberId`, and the membership-join
// query sometimes returns nothing for this worker's profile. Both
// flakes resolve once each test only touches what it created.

const insertUserAndProfile = async (
  id: string,
  opts: {
    displayName?: string;
    saved?: boolean;
    buttondownSubscriberId?: string | null;
    email?: string;
    hidden?: boolean;
  } = {},
) => {
  const email = opts.email ?? `${id}@testfake.local`;
  await db.execute(
    sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${email}, false, false)`,
  );
  await db.insert(profiles).values({
    id,
    displayName: opts.displayName ?? null,
    lastUpdatedProfile: opts.saved === false ? null : new Date(),
    buttondownSubscriberId: opts.buttondownSubscriberId ?? null,
    hidden: opts.hidden ?? false,
  });
};

const deleteUserAndProfile = async (id: string) => {
  await db.delete(profiles).where(eq(profiles.id, id));
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
};

const seedProgram = async (opts: {
  name?: string;
  slug?: string;
  buttondownTag?: string | null;
  archived?: boolean;
} = {}): Promise<string> => {
  const id = randomUUID();
  await db.insert(programs).values({
    id,
    slug: opts.slug ?? `prog-${id.slice(0, 8)}`,
    name: opts.name ?? "Test Program",
    buttondownTag: opts.buttondownTag ?? null,
    archivedAt: opts.archived ? new Date() : null,
  });
  return id;
};

const join = async (profileId: string, programId: string) => {
  await db.insert(profilePrograms).values({ profileId, programId });
};

const collectingLogger = () => {
  const events: SyncLogEvent[] = [];
  return { events, log: (e: SyncLogEvent) => events.push(e) };
};

const collectingAlerts = () => {
  const alerts: UnsubscribeAlert[] = [];
  return { alerts, raise: (a: UnsubscribeAlert) => alerts.push(a) };
};

const sampleSubscriber = (
  over: Partial<ButtondownSubscriber> & { id: string; email_address: string },
): ButtondownSubscriber => ({ type: "regular", tags: [], ...over });

// Pulls the effects relating to a single subscriber id or email, so
// tests can assert against their own profile's actions without being
// polluted by other rows the sync also processed.
const effectsForEmail = (effects: FakeButtondownEffect[], email: string): FakeButtondownEffect[] =>
  effects.filter((e) =>
    e.kind === "create"
      ? e.input.email_address.toLowerCase() === email.toLowerCase()
      : false,
  );

const effectsForSubscriberId = (effects: FakeButtondownEffect[], id: string): FakeButtondownEffect[] =>
  effects.filter((e) => (e.kind === "update" ? e.id === id : false));

describe("runButtondownSync (daily reconciler)", () => {
  let profileIds: string[];
  let programIds: string[];

  beforeEach(() => {
    profileIds = [];
    programIds = [];
  });

  afterEach(async () => {
    if (profileIds.length > 0) {
      await db.delete(profilePrograms).where(inArray(profilePrograms.profileId, profileIds));
    }
    if (programIds.length > 0) {
      await db.delete(programs).where(inArray(programs.id, programIds));
    }
    for (const id of profileIds) {
      await deleteUserAndProfile(id);
    }
  });

  const makeProfile = async (opts: Parameters<typeof insertUserAndProfile>[1] = {}): Promise<string> => {
    const id = randomUUID();
    profileIds.push(id);
    await insertUserAndProfile(id, opts);
    return id;
  };

  const makeProgram = async (opts: Parameters<typeof seedProgram>[0] = {}): Promise<string> => {
    const id = await seedProgram(opts);
    programIds.push(id);
    return id;
  };

  it("creates a subscriber when none exists, with isweb-member + new tags", async () => {
    const profileId = await makeProfile({ email: "alice@example.com" });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await join(profileId, programId);

    const client = createFakeButtondownClient({ write: true });
    const { log, events } = collectingLogger();

    await runButtondownSync({ client, runId: "r1", write: true, log, scopeProfileIds: [profileId] });

    const myEffects = effectsForEmail(client.effects, "alice@example.com");
    expect(myEffects).toHaveLength(1);
    expect(myEffects[0]).toMatchObject({
      kind: "create",
      input: { email_address: "alice@example.com", tags: ["weekly", "isweb-member", "new"] },
      dryRun: false,
    });

    const [row] = await db
      .select({ buttondownSubscriberId: profiles.buttondownSubscriberId })
      .from(profiles)
      .where(eq(profiles.id, profileId));
    expect(row.buttondownSubscriberId).not.toBeNull();

    expect(
      events.find((e) => e.action === "subscriber-created" && e.profileId === profileId),
    ).toBeDefined();
  });

  it("PATCHes a subscribed person's tags when the managed set has drifted", async () => {
    const profileId = await makeProfile({ email: "bob@example.com" });
    const weeklyProgramId = await makeProgram({ buttondownTag: "weekly" });
    await makeProgram({ buttondownTag: "monthly" }); // in managed universe, Bob isn't in it
    await join(profileId, weeklyProgramId);

    const initial = sampleSubscriber({
      id: "sub_bob",
      email_address: "bob@example.com",
      tags: ["monthly", "human-set", "isweb-member"],
    });
    const client = createFakeButtondownClient({ write: true, initialSubscribers: [initial] });

    await runButtondownSync({ client, runId: "r2", write: true, scopeProfileIds: [profileId] });

    const myEffects = effectsForSubscriberId(client.effects, "sub_bob");
    expect(myEffects).toHaveLength(1);
    expect(myEffects[0].kind).toBe("update");

    const updated = await client.getSubscriber("sub_bob");
    // Managed universe: {"weekly", "monthly"}. Bob is in "weekly" only.
    // monthly stripped; weekly added; non-managed tags preserved.
    expect(updated?.tags.sort()).toEqual(["human-set", "isweb-member", "weekly"]);
  });

  it("leaves non-managed tags alone and produces no PATCH when already current", async () => {
    const profileId = await makeProfile({
      email: "carol@example.com",
      buttondownSubscriberId: "sub_carol",
    });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await join(profileId, programId);

    const initial = sampleSubscriber({
      id: "sub_carol",
      email_address: "carol@example.com",
      tags: ["weekly", "vip", "donor-2025", "isweb-member"],
    });
    const client = createFakeButtondownClient({ write: true, initialSubscribers: [initial] });

    await runButtondownSync({ client, runId: "r3", write: true, scopeProfileIds: [profileId] });

    expect(effectsForSubscriberId(client.effects, "sub_carol")).toHaveLength(0);
  });

  it("strips a tag when its program is archived (archived drops out of the desired set)", async () => {
    const profileId = await makeProfile({
      email: "dan@example.com",
      buttondownSubscriberId: "sub_dan",
    });
    const archivedProgramId = await makeProgram({ buttondownTag: "archived-weekly", archived: true });
    await join(profileId, archivedProgramId);

    const initial = sampleSubscriber({
      id: "sub_dan",
      email_address: "dan@example.com",
      tags: ["archived-weekly", "isweb-member"],
    });
    const client = createFakeButtondownClient({ write: true, initialSubscribers: [initial] });

    await runButtondownSync({ client, runId: "r4", write: true, scopeProfileIds: [profileId] });

    const updated = await client.getSubscriber("sub_dan");
    expect(updated?.tags).toEqual(["isweb-member"]);
  });

  it("raises an unsubscribe alert and skips writes for an unsubscribed subscriber", async () => {
    const profileId = await makeProfile({
      email: "eve@example.com",
      buttondownSubscriberId: "sub_eve",
    });
    const programId = await makeProgram({ buttondownTag: "weekly", slug: "weekly-prog" });
    await join(profileId, programId);

    const initial = sampleSubscriber({
      id: "sub_eve",
      email_address: "eve@example.com",
      type: "unsubscribed",
      tags: ["weekly"],
    });
    const client = createFakeButtondownClient({ write: true, initialSubscribers: [initial] });
    const { alerts, raise } = collectingAlerts();

    await runButtondownSync({ client, runId: "r5", write: true, raiseUnsubscribeAlert: raise, scopeProfileIds: [profileId] });

    expect(effectsForSubscriberId(client.effects, "sub_eve")).toHaveLength(0);
    const my = alerts.find((a) => a.profileId === profileId);
    expect(my).toMatchObject({
      profileId,
      email: "eve@example.com",
      programSlugsHeld: ["weekly-prog"],
    });
  });

  it("PATCHes email when the stored subscriber id resolves but the email has changed", async () => {
    const profileId = await makeProfile({
      email: "frank-new@example.com",
      buttondownSubscriberId: "sub_frank",
    });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await join(profileId, programId);

    const initial = sampleSubscriber({
      id: "sub_frank",
      email_address: "frank-old@example.com",
      tags: ["weekly", "isweb-member"],
    });
    const client = createFakeButtondownClient({ write: true, initialSubscribers: [initial] });

    await runButtondownSync({ client, runId: "r6", write: true, scopeProfileIds: [profileId] });

    const updated = await client.getSubscriber("sub_frank");
    expect(updated?.email_address).toBe("frank-new@example.com");
    expect(profileId).toBeTruthy();
  });

  it("records the subscriber id on a profile we find by email lookup", async () => {
    const profileId = await makeProfile({ email: "gina@example.com" });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await join(profileId, programId);

    const initial = sampleSubscriber({
      id: "sub_gina",
      email_address: "gina@example.com",
      tags: ["weekly", "isweb-member"],
    });
    const client = createFakeButtondownClient({ write: true, initialSubscribers: [initial] });

    await runButtondownSync({ client, runId: "r7", write: true, scopeProfileIds: [profileId] });

    const [row] = await db
      .select({ buttondownSubscriberId: profiles.buttondownSubscriberId })
      .from(profiles)
      .where(eq(profiles.id, profileId));
    expect(row.buttondownSubscriberId).toBe("sub_gina");
  });

  it("dry-runs without writing when write=false on the client", async () => {
    const profileId = await makeProfile({ email: "henry@example.com" });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await join(profileId, programId);

    const client = createFakeButtondownClient({ write: false });

    await runButtondownSync({ client, runId: "r8", write: false, scopeProfileIds: [profileId] });

    const myEffects = effectsForEmail(client.effects, "henry@example.com");
    expect(myEffects[0]).toMatchObject({ kind: "create", dryRun: true });
    expect(await client.getSubscriber("henry@example.com")).toBeNull();
    const [row] = await db
      .select({ buttondownSubscriberId: profiles.buttondownSubscriberId })
      .from(profiles)
      .where(eq(profiles.id, profileId));
    expect(row.buttondownSubscriberId).toBeNull();
  });

  it("skips profiles without a saved profile (lastUpdatedProfile IS NULL)", async () => {
    const profileId = await makeProfile({ email: "isaac@example.com", saved: false });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await join(profileId, programId);

    const client = createFakeButtondownClient({ write: true });
    await runButtondownSync({ client, runId: "r9", write: true, scopeProfileIds: [profileId] });

    // Isaac's email should never have been touched.
    expect(effectsForEmail(client.effects, "isaac@example.com")).toHaveLength(0);
  });

  it("includes profiles whose only programs have no buttondownTag (catch-up creates with empty managed set)", async () => {
    const profileId = await makeProfile({ email: "jess@example.com" });
    const programId = await makeProgram({ buttondownTag: null });
    await join(profileId, programId);

    const client = createFakeButtondownClient({ write: true });
    await runButtondownSync({ client, runId: "r10", write: true, scopeProfileIds: [profileId] });

    const myEffects = effectsForEmail(client.effects, "jess@example.com");
    expect(myEffects).toHaveLength(1);
    expect(myEffects[0]).toMatchObject({
      kind: "create",
      input: { tags: ["isweb-member", "new"] },
    });
    expect(profileId).toBeTruthy();
  });

  it("skips create for a hidden profile not yet in Buttondown", async () => {
    const profileId = await makeProfile({ email: "kelvin@example.com", hidden: true });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await join(profileId, programId);

    const client = createFakeButtondownClient({ write: true });
    const { log, events } = collectingLogger();

    const summary = await runButtondownSync({
      client,
      runId: "r-hidden-create",
      write: true,
      log,
      scopeProfileIds: [profileId],
    });

    expect(effectsForEmail(client.effects, "kelvin@example.com")).toHaveLength(0);
    expect(summary.created).toBe(0);
    expect(summary.skippedHiddenCreate).toBe(1);
    expect(
      events.find((e) => e.action === "skipped-hidden-create" && e.profileId === profileId),
    ).toBeDefined();
  });

  // Defense in depth against an E2E or fixture user that somehow has
  // a saved profile in prod. The reconciler must skip these before
  // any client call and surface them in the summary.
  it("skips a profile whose email ends in a reserved TLD", async () => {
    const profileId = await makeProfile({ email: "sweep-test@testfake.local" });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await join(profileId, programId);

    const client = createFakeButtondownClient({ write: true });
    const { events, log } = collectingLogger();

    const summary = await runButtondownSync({
      client,
      runId: "r-reserved",
      write: true,
      scopeProfileIds: [profileId],
      log,
    });

    expect(client.effects).toHaveLength(0);
    expect(summary.skippedReservedEmail).toBe(1);
    expect(summary.created).toBe(0);
    expect(events).toContainEqual({
      action: "skipped-reserved-email",
      runId: "r-reserved",
      profileId,
      email: "sweep-test@testfake.local",
    });
  });

  it("still PATCHes tags for a hidden profile that already has a Buttondown subscriber", async () => {
    const profileId = await makeProfile({
      email: "leo@example.com",
      hidden: true,
      buttondownSubscriberId: "sub_leo",
    });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await join(profileId, programId);

    const initial = sampleSubscriber({
      id: "sub_leo",
      email_address: "leo@example.com",
      tags: ["isweb-member"],
    });
    const client = createFakeButtondownClient({ write: true, initialSubscribers: [initial] });

    const summary = await runButtondownSync({
      client,
      runId: "r-hidden-update",
      write: true,
      scopeProfileIds: [profileId],
    });

    const updated = await client.getSubscriber("sub_leo");
    expect(updated?.tags.sort()).toEqual(["isweb-member", "weekly"]);
    expect(summary.tagsUpdated).toBe(1);
    expect(summary.skippedHiddenCreate).toBe(0);
  });
});

// buildSubscriberLookup picks the right strategy based on whether
// the caller passed a profile scope. The broad daily reconciler
// gets a single listSubscribers preload (cheap when the audience is
// mostly correct); the inline per-profile resync gets the legacy
// per-profile getSubscriber path (cheap when only one row matters).
//
// These are pure-function tests against a stub client — no DB —
// because the broad path is impossible to exercise hermetically
// through runButtondownSync under parallel-file vitest: an
// unscoped run reads every profile in the shared dev DB and races
// other workers. Asserting the strategy at the helper level keeps
// the test deterministic.
describe("buildSubscriberLookup", () => {
  const sub = (over: Partial<ButtondownSubscriber> & { id: string; email_address: string }): ButtondownSubscriber => ({
    type: "regular",
    tags: [],
    ...over,
  });

  type SpyClient = {
    listSubscribers: ReturnType<typeof vi.fn>;
    getSubscriber: ReturnType<typeof vi.fn>;
  };

  const makeSpyClient = (subscribers: ButtondownSubscriber[]): SpyClient => ({
    listSubscribers: vi.fn(async () => subscribers),
    getSubscriber: vi.fn(async (idOrEmail: string) => {
      for (const s of subscribers) {
        if (s.id === idOrEmail) return s;
        if (s.email_address.toLowerCase() === idOrEmail.toLowerCase()) return s;
      }
      return null;
    }),
  });

  it("broad path: lists subscribers once and serves all lookups from the in-memory map", async () => {
    const subs = [
      sub({ id: "sub_a", email_address: "alpha@example.com" }),
      sub({ id: "sub_b", email_address: "beta@example.com" }),
    ];
    const client = makeSpyClient(subs);
    const lookup = await buildSubscriberLookup(client as never, undefined);

    expect(client.listSubscribers).toHaveBeenCalledTimes(1);
    expect(client.getSubscriber).not.toHaveBeenCalled();

    // Lookups consult the cached map — no further HTTP.
    const byId = await lookup({ email: "irrelevant@example.com", buttondownSubscriberId: "sub_a" });
    expect(byId?.id).toBe("sub_a");
    const byEmail = await lookup({ email: "beta@example.com", buttondownSubscriberId: null });
    expect(byEmail?.id).toBe("sub_b");
    const missing = await lookup({ email: "nobody@example.com", buttondownSubscriberId: null });
    expect(missing).toBeNull();

    expect(client.getSubscriber).not.toHaveBeenCalled();
    expect(client.listSubscribers).toHaveBeenCalledTimes(1);
  });

  it("broad path: stale stored subscriberId falls back to the email index", async () => {
    const subs = [sub({ id: "sub_real", email_address: "carla@example.com" })];
    const client = makeSpyClient(subs);
    const lookup = await buildSubscriberLookup(client as never, undefined);

    const found = await lookup({
      email: "carla@example.com",
      buttondownSubscriberId: "sub_stale_that_no_longer_exists",
    });
    expect(found?.id).toBe("sub_real");
  });

  it("scoped path: never calls listSubscribers; does per-profile getSubscriber", async () => {
    const subs = [sub({ id: "sub_only", email_address: "solo@example.com" })];
    const client = makeSpyClient(subs);
    const lookup = await buildSubscriberLookup(client as never, ["p1"]);

    expect(client.listSubscribers).not.toHaveBeenCalled();

    const found = await lookup({ email: "solo@example.com", buttondownSubscriberId: "sub_only" });
    expect(found?.id).toBe("sub_only");
    // id-first, no email fallback when id resolves.
    expect(client.getSubscriber).toHaveBeenCalledTimes(1);
    expect(client.getSubscriber).toHaveBeenCalledWith("sub_only");
  });
});
