import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

// The member-delete control reaches supabaseAdmin (auth deleteUser,
// storage remove); mocked so no call leaves the process. Same shape as
// admin-members-delete.test.ts.
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: { admin: { deleteUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } },
    storage: {
      from: () => ({
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
        createSignedUrls: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    },
  },
}));

// The Buttondown write control would otherwise call the Buttondown API.
vi.mock("@/server/buttondown-runner", () => ({
  runButtondownSyncForServer: vi.fn().mockResolvedValue({ status: "ok" }),
  runFirstProfileSaveForServer: vi.fn(),
  runProfileResyncForServer: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";

import app from "@/server/api";
import { E2E_ADMIN_READS } from "@/server/auth-middleware";
import { runButtondownSyncForServer } from "@/server/buttondown-runner";
import { db } from "@/server/db";
import { createInvite } from "@/server/invites";
import { invites, profiles } from "@/server/schema";
import { E2E_EMAILS } from "@/server/test-reset";

const mockCreateServerClient = vi.mocked(createServerClient);
const mockButtondownSync = vi.mocked(runButtondownSyncForServer);

const E2E_ADMIN_EMAIL = E2E_EMAILS[1];

// The session email is the only thing that differs between a guarded
// request and its control: requireAdmin reads the email from the
// session, isAdmin reads the flag by id. The auth.users row keeps a
// unique per-run address so it can't collide with a seeded e2e account
// on dev DBs.
const authAs = (id: string, email: string, appMetadata: Record<string, unknown> = {}) => {
  mockCreateServerClient.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id,
            email,
            user_metadata: {},
            app_metadata: appMetadata,
            aud: "authenticated",
            created_at: "2026-01-01T00:00:00Z",
          } as User,
        },
        error: null,
      }),
    },
    // biome-ignore lint/suspicious/noExplicitAny: test mock shape
  } as any);
};

const insertUserAndProfile = async (id: string, opts: { isAdmin?: boolean } = {}) => {
  await db.execute(
    sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${`${id}@testfake.local`}, false, false)`,
  );
  await db.insert(profiles).values({ id, isAdmin: opts.isAdmin ?? false });
};

const deleteUserAndProfile = async (id: string) => {
  await db.delete(profiles).where(eq(profiles.id, id));
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
};

type Ctx = { admin: string; member: string; inviteId: string; inviteCode: string };

type DeniedCase = {
  name: string;
  request: (ctx: Ctx) => [path: string, init?: RequestInit];
  e2eStatus: number;
  adminStatus: number;
  // Whether the route's side effect happened; omitted for reads.
  effect?: (ctx: Ctx) => Promise<boolean>;
};

const jsonPatch = (body: unknown): RequestInit => ({
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const read = (path: string): DeniedCase => ({
  name: `GET ${path}`,
  request: () => [path],
  e2eStatus: 404,
  adminStatus: 200,
});

const DENIED: DeniedCase[] = [
  {
    name: "promote a member to admin",
    request: (ctx) => [`/api/admin/members/${ctx.member}/admin`, jsonPatch({ isAdmin: true })],
    e2eStatus: 404,
    adminStatus: 200,
    effect: async (ctx) => {
      const [row] = await db.select({ isAdmin: profiles.isAdmin }).from(profiles).where(eq(profiles.id, ctx.member));
      return row.isAdmin;
    },
  },
  {
    name: "delete a member",
    request: (ctx) => [`/api/admin/members/${ctx.member}`, { method: "DELETE" }],
    e2eStatus: 404,
    adminStatus: 200,
    effect: async (ctx) => {
      const rows = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, ctx.member));
      return rows.length === 0;
    },
  },
  {
    name: "hard-delete an invite",
    request: (ctx) => [`/api/admin/invites/${ctx.inviteId}`, { method: "DELETE" }],
    e2eStatus: 404,
    adminStatus: 200,
    effect: async (ctx) => {
      const rows = await db.select({ id: invites.id }).from(invites).where(eq(invites.id, ctx.inviteId));
      return rows.length === 0;
    },
  },
  {
    name: "revoke another member's invite",
    request: (ctx) => [`/api/invites/${ctx.inviteCode}/revoke`, { method: "POST" }],
    e2eStatus: 403,
    adminStatus: 200,
    effect: async (ctx) => {
      const [row] = await db.select({ revokedAt: invites.revokedAt }).from(invites).where(eq(invites.id, ctx.inviteId));
      return row.revokedAt !== null;
    },
  },
  {
    name: "run a Buttondown write sync",
    request: () => ["/api/admin/buttondown-sync/write", { method: "POST" }],
    e2eStatus: 404,
    adminStatus: 200,
    effect: async () => mockButtondownSync.mock.calls.length > 0,
  },
  read("/api/admin/members"),
  read("/api/admin/member-emails"),
  read("/api/admin/signins"),
  read("/api/admin/invites"),
];

describe("e2e admin account guard", () => {
  // Several controls delete rows. Each targets only a row this test
  // inserted under a fresh UUID, and setup.ts keeps the suite off any
  // non-local database.
  const ctx = {} as Ctx;

  beforeEach(async () => {
    ctx.admin = randomUUID();
    ctx.member = randomUUID();
    await insertUserAndProfile(ctx.admin, { isAdmin: true });
    await insertUserAndProfile(ctx.member);
    const r = await createInvite({ createdBy: ctx.member, note: "e2e admin guard" });
    if ("error" in r) throw new Error("seed failed");
    const [row] = await db.select({ id: invites.id }).from(invites).where(eq(invites.code, r.code));
    ctx.inviteId = row.id;
    ctx.inviteCode = r.code;
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    mockButtondownSync.mockClear();
    // By id: deleting the member null-sets invites.created_by.
    await db.delete(invites).where(eq(invites.id, ctx.inviteId));
    await deleteUserAndProfile(ctx.admin);
    await deleteUserAndProfile(ctx.member);
  });

  it.each(E2E_ADMIN_READS)("allows the e2e suite's read %s", async (path) => {
    authAs(ctx.admin, E2E_ADMIN_EMAIL);
    const res = await app.request(path);
    expect(res.status).toBe(200);
  });

  // A password holder can move the account off its testfake.local email
  // (see isE2EAccount); the app_metadata flag keeps the guard on.
  it("still denies a flagged account after an email change", async () => {
    authAs(ctx.admin, `${ctx.admin}@testfake.local`, { e2e_account: true });
    const res = await app.request(`/api/admin/members/${ctx.member}/admin`, jsonPatch({ isAdmin: true }));
    expect(res.status).toBe(404);
    const [row] = await db.select({ isAdmin: profiles.isAdmin }).from(profiles).where(eq(profiles.id, ctx.member));
    expect(row.isAdmin).toBe(false);
  });

  // Each case runs twice with the same user id, route and body. The
  // control proves the route works, so the e2e denial can't pass on a
  // typo'd path or a rejected body.
  describe.each(DENIED)("$name", (tc) => {
    it("is denied to the e2e admin", async () => {
      authAs(ctx.admin, E2E_ADMIN_EMAIL);
      const res = await app.request(...tc.request(ctx));
      expect(res.status).toBe(tc.e2eStatus);
      if (tc.effect) expect(await tc.effect(ctx)).toBe(false);
    });

    it("is allowed to a regular admin (control)", async () => {
      authAs(ctx.admin, `${ctx.admin}@testfake.local`);
      const res = await app.request(...tc.request(ctx));
      expect(res.status).toBe(tc.adminStatus);
      if (tc.effect) expect(await tc.effect(ctx)).toBe(true);
    });
  });
});
