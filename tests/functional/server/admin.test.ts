import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";

import app from "@/server/api";
import { db } from "@/server/db";
import { profiles } from "@/server/schema";

const mockCreateServerClient = vi.mocked(createServerClient);

const fakeUser = (id: string): User =>
  ({
    id,
    email: `${id}@testfake.local`,
    user_metadata: {},
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  }) as User;

const authAs = (userId: string | null) => {
  mockCreateServerClient.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? fakeUser(userId) : null },
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

describe("GET /api/admin/appsettings", () => {
  let admin: string;
  let nonAdmin: string;

  beforeEach(async () => {
    admin = randomUUID();
    nonAdmin = randomUUID();
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(nonAdmin);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(nonAdmin);
  });

  it("returns settings for an admin", async () => {
    authAs(admin);
    const res = await app.request("/api/admin/appsettings");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ appSettings: {} });
  });

  it("returns 404 for an authenticated non-admin", async () => {
    authAs(nonAdmin);
    const res = await app.request("/api/admin/appsettings");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 401 when no session is present", async () => {
    authAs(null);
    const res = await app.request("/api/admin/appsettings");
    expect(res.status).toBe(401);
  });
});
