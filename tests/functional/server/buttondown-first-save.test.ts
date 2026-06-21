import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ButtondownSubscriber } from "@/server/buttondown";
import { runFirstProfileSaveSync, type UnsubscribeAlert } from "@/server/buttondown-sync";
import { db } from "@/server/db";
import { profilePrograms, profiles, programs } from "@/server/schema";

import { createFakeButtondownClient } from "./buttondown-fake";

const insertUserAndProfile = async (
  id: string,
  opts: {
    email?: string;
    buttondownSubscriberId?: string | null;
    saved?: boolean;
    hidden?: boolean;
    displayName?: string | null;
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

describe("runFirstProfileSaveSync (inline hook)", () => {
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

  const makeProgram = async (opts: { slug?: string; buttondownTag?: string | null } = {}): Promise<string> => {
    const id = randomUUID();
    programIds.push(id);
    await db.insert(programs).values({
      id,
      slug: opts.slug ?? `prog-${id.slice(0, 8)}`,
      name: "First-save test program",
      buttondownTag: opts.buttondownTag ?? null,
    });
    return id;
  };

  it("creates the subscriber with isweb-member + new when none exists", async () => {
    const profileId = await makeProfile({ email: "fs-alice@example.com" });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await db.insert(profilePrograms).values({ profileId, programId });

    const client = createFakeButtondownClient({ write: true });

    await runFirstProfileSaveSync({ profileId, email: "fs-alice@example.com", client });

    expect(client.effects).toHaveLength(1);
    expect(client.effects[0]).toMatchObject({
      kind: "create",
      input: { email_address: "fs-alice@example.com", tags: ["weekly", "isweb-member", "new"] },
    });

    const [row] = await db
      .select({ buttondownSubscriberId: profiles.buttondownSubscriberId })
      .from(profiles)
      .where(eq(profiles.id, profileId));
    expect(row.buttondownSubscriberId).not.toBeNull();
  });

  it("seeds metadata.name on create from the profile's display name", async () => {
    const profileId = await makeProfile({ email: "fs-name@example.com", displayName: "Ada Lovelace" });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await db.insert(profilePrograms).values({ profileId, programId });

    const client = createFakeButtondownClient({ write: true });
    await runFirstProfileSaveSync({ profileId, email: "fs-name@example.com", client });

    expect(client.effects[0]).toMatchObject({
      kind: "create",
      input: { email_address: "fs-name@example.com", metadata: { name: "Ada Lovelace" } },
    });
    const after = await client.getSubscriber("fs-name@example.com");
    expect(after?.metadata).toEqual({ name: "Ada Lovelace" });
  });

  it("merges name into the full-overwrite PATCH, preserving other metadata", async () => {
    const profileId = await makeProfile({ email: "fs-merge@example.com", displayName: "Grace Hopper" });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await db.insert(profilePrograms).values({ profileId, programId });

    const initial: ButtondownSubscriber = {
      id: "sub_merge",
      email_address: "fs-merge@example.com",
      type: "regular",
      tags: ["legacy-active"],
      metadata: { external_id: "crm-42" },
    };
    const client = createFakeButtondownClient({ write: true, initialSubscribers: [initial] });
    await runFirstProfileSaveSync({ profileId, email: "fs-merge@example.com", client });

    const after = await client.getSubscriber("sub_merge");
    expect(after?.tags).toEqual(["isweb-member", "returning", "weekly"]);
    // external_id survives the overwrite; name is added alongside it.
    expect(after?.metadata).toEqual({ external_id: "crm-42", name: "Grace Hopper" });
  });

  it("writes no metadata.name when the display name is blank", async () => {
    const profileId = await makeProfile({ email: "fs-blank@example.com", displayName: "   " });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await db.insert(profilePrograms).values({ profileId, programId });

    const client = createFakeButtondownClient({ write: true });
    await runFirstProfileSaveSync({ profileId, email: "fs-blank@example.com", client });

    const created = client.effects[0];
    expect(created.kind).toBe("create");
    // Never seed an empty/whitespace name onto a fresh subscriber.
    if (created.kind === "create") expect(created.input.metadata).toBeUndefined();
  });

  it("does a full-overwrite PATCH with isweb-member + returning when subscriber exists and lacks isweb-member", async () => {
    const profileId = await makeProfile({ email: "fs-bob@example.com" });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await db.insert(profilePrograms).values({ profileId, programId });

    const initial: ButtondownSubscriber = {
      id: "sub_bob",
      email_address: "fs-bob@example.com",
      type: "regular",
      tags: ["legacy-active", "human-vip"],
    };
    const client = createFakeButtondownClient({ write: true, initialSubscribers: [initial] });

    await runFirstProfileSaveSync({ profileId, email: "fs-bob@example.com", client });

    const after = await client.getSubscriber("sub_bob");
    // Full overwrite — legacy-active and human-vip both gone, as
    // the design intends for the discrete signup moment. Real
    // Buttondown (and the fake) return tags sorted ascending.
    expect(after?.tags).toEqual(["isweb-member", "returning", "weekly"]);

    const [row] = await db
      .select({ buttondownSubscriberId: profiles.buttondownSubscriberId })
      .from(profiles)
      .where(eq(profiles.id, profileId));
    expect(row.buttondownSubscriberId).toBe("sub_bob");
  });

  it("no-ops when the subscriber already has isweb-member (don't clobber human tags)", async () => {
    const profileId = await makeProfile({ email: "fs-carol@example.com" });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await db.insert(profilePrograms).values({ profileId, programId });

    const initial: ButtondownSubscriber = {
      id: "sub_carol",
      email_address: "fs-carol@example.com",
      type: "regular",
      tags: ["weekly", "human-vip", "isweb-member"],
    };
    const client = createFakeButtondownClient({ write: true, initialSubscribers: [initial] });

    await runFirstProfileSaveSync({ profileId, email: "fs-carol@example.com", client });

    // Tags unchanged.
    const after = await client.getSubscriber("sub_carol");
    expect(after?.tags.sort()).toEqual(["human-vip", "isweb-member", "weekly"]);
    // No write effects at all.
    expect(client.effects).toHaveLength(0);
    // Subscriber id still recorded.
    const [row] = await db
      .select({ buttondownSubscriberId: profiles.buttondownSubscriberId })
      .from(profiles)
      .where(eq(profiles.id, profileId));
    expect(row.buttondownSubscriberId).toBe("sub_carol");
  });

  it("raises an unsubscribe alert and writes nothing when the subscriber is unsubscribed", async () => {
    const profileId = await makeProfile({ email: "fs-dan@example.com" });
    // Unique slug per run: parallel files share one DB, so a fixed slug
    // races buttondown-sync's twin test on programs_slug_unique.
    const heldSlug = `weekly-prog-${randomUUID().slice(0, 8)}`;
    const programId = await makeProgram({ buttondownTag: "weekly", slug: heldSlug });
    await db.insert(profilePrograms).values({ profileId, programId });

    const initial: ButtondownSubscriber = {
      id: "sub_dan",
      email_address: "fs-dan@example.com",
      type: "unsubscribed",
      tags: ["weekly"],
    };
    const client = createFakeButtondownClient({ write: true, initialSubscribers: [initial] });

    const alerts: UnsubscribeAlert[] = [];
    await runFirstProfileSaveSync({
      profileId,
      email: "fs-dan@example.com",
      client,
      raiseUnsubscribeAlert: (a) => alerts.push(a),
    });

    expect(client.effects).toHaveLength(0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      profileId,
      email: "fs-dan@example.com",
      programSlugsHeld: [heldSlug],
    });
  });

  it("dry-run records the create effect without persisting subscriber id on the profile", async () => {
    const profileId = await makeProfile({ email: "fs-eve@example.com" });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await db.insert(profilePrograms).values({ profileId, programId });

    const client = createFakeButtondownClient({ write: false });

    await runFirstProfileSaveSync({ profileId, email: "fs-eve@example.com", client });

    expect(client.effects[0]).toMatchObject({ kind: "create", dryRun: true });
    const [row] = await db
      .select({ buttondownSubscriberId: profiles.buttondownSubscriberId })
      .from(profiles)
      .where(eq(profiles.id, profileId));
    expect(row.buttondownSubscriberId).toBeNull();
  });

  it("skips the create entirely for a hidden profile with no existing subscriber", async () => {
    const profileId = await makeProfile({ email: "fs-frank@example.com", hidden: true });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await db.insert(profilePrograms).values({ profileId, programId });

    const client = createFakeButtondownClient({ write: true });

    await runFirstProfileSaveSync({ profileId, email: "fs-frank@example.com", client });

    expect(client.effects).toHaveLength(0);
    const [row] = await db
      .select({ buttondownSubscriberId: profiles.buttondownSubscriberId })
      .from(profiles)
      .where(eq(profiles.id, profileId));
    expect(row.buttondownSubscriberId).toBeNull();
  });

  it("still PATCHes tags for a hidden profile whose subscriber already exists", async () => {
    const profileId = await makeProfile({ email: "fs-gina@example.com", hidden: true });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await db.insert(profilePrograms).values({ profileId, programId });

    const initial: ButtondownSubscriber = {
      id: "sub_gina",
      email_address: "fs-gina@example.com",
      type: "regular",
      tags: ["legacy-active"],
    };
    const client = createFakeButtondownClient({ write: true, initialSubscribers: [initial] });

    await runFirstProfileSaveSync({ profileId, email: "fs-gina@example.com", client });

    const after = await client.getSubscriber("sub_gina");
    expect(after?.tags).toEqual(["isweb-member", "returning", "weekly"]);
  });

  // Defense in depth against an E2E or fixture user reaching this
  // hook in a prod-keyed environment. The hook must not call into the
  // client for a reserved-TLD email — no mutations, no recorded id.
  it("skips entirely when the email ends in a reserved TLD", async () => {
    const profileId = await makeProfile({ email: "fs-test@testfake.local" });
    const programId = await makeProgram({ buttondownTag: "weekly" });
    await db.insert(profilePrograms).values({ profileId, programId });

    const client = createFakeButtondownClient({ write: true });

    await runFirstProfileSaveSync({ profileId, email: "fs-test@testfake.local", client });

    expect(client.effects).toHaveLength(0);
    expect(client.subscribers.size).toBe(0);
    const [row] = await db
      .select({ buttondownSubscriberId: profiles.buttondownSubscriberId })
      .from(profiles)
      .where(eq(profiles.id, profileId));
    expect(row.buttondownSubscriberId).toBeNull();
  });
});
