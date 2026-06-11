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
import type { AdminSignin } from "@/server/signins-admin";

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

const setLastSignIn = async (id: string, iso: string) => {
  await db.execute(sql`UPDATE auth.users SET last_sign_in_at = ${iso}::timestamptz WHERE id = ${id}::uuid`);
};

// auth.sessions.refreshed_at is a timestamp WITHOUT time zone holding UTC,
// so strip the ISO suffix rather than let Postgres apply a zone shift.
// The row cascade-deletes with its auth.users row.
const insertSession = async (userId: string, refreshedAtIso: string) => {
  const refreshedAt = refreshedAtIso.replace("T", " ").replace("Z", "");
  await db.execute(
    sql`INSERT INTO auth.sessions (id, user_id, refreshed_at) VALUES (${randomUUID()}::uuid, ${userId}::uuid, ${refreshedAt}::timestamp)`,
  );
};

describe("GET /api/admin/signins", () => {
  let admin: string;
  let recent: string;
  let older: string;
  let never: string;

  const RECENT_AT = "2026-06-10T08:30:00.000Z";
  const RECENT_ACTIVE_AT = "2026-06-10T09:15:00.000Z";
  const OLDER_AT = "2026-05-01T17:45:00.000Z";

  beforeEach(async () => {
    admin = randomUUID();
    recent = randomUUID();
    older = randomUUID();
    never = randomUUID();
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(recent);
    await insertUserAndProfile(older);
    await insertUserAndProfile(never);
    // Names make the NULLS-LAST tail order deterministic (sorted by
    // lowercased display name): Alex Admin before Nina Never.
    await db.update(profiles).set({ displayName: "Alex Admin" }).where(eq(profiles.id, admin));
    await db.update(profiles).set({ displayName: "Rita Recent" }).where(eq(profiles.id, recent));
    await db.update(profiles).set({ displayName: "Olaf Older", hidden: true }).where(eq(profiles.id, older));
    await db
      .update(profiles)
      .set({ displayName: "Nina Never", deactivatedAt: new Date() })
      .where(eq(profiles.id, never));
    await setLastSignIn(recent, RECENT_AT);
    await setLastSignIn(older, OLDER_AT);
    await insertSession(recent, RECENT_ACTIVE_AT);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(recent);
    await deleteUserAndProfile(older);
    await deleteUserAndProfile(never);
  });

  it("returns every member, most recent sign-in first, never-signed-in last", async () => {
    authAs(admin);
    const res = await app.request("/api/admin/signins");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signins: AdminSignin[] };

    // Other test files seed users concurrently, so assert on this
    // test's fixtures only — filtering preserves relative order.
    const mine = body.signins.filter((s) => [admin, recent, older, never].includes(s.id));
    expect(mine.map((s) => s.id)).toEqual([recent, older, admin, never]);

    expect(mine[0]).toEqual({
      id: recent,
      displayName: "Rita Recent",
      lastSignInAt: RECENT_AT,
      // Live-session token refresh wins over the sign-in timestamp.
      lastActivityAt: RECENT_ACTIVE_AT,
      hidden: false,
      deactivated: false,
    });
    // No live session → activity falls back to the sign-in timestamp.
    expect(mine[1]).toMatchObject({ lastSignInAt: OLDER_AT, lastActivityAt: OLDER_AT, hidden: true });
    expect(mine[2]).toMatchObject({ lastSignInAt: null });
    expect(mine[3]).toMatchObject({ lastSignInAt: null, lastActivityAt: null, deactivated: true });
  });

  it("returns 404 for an authenticated non-admin", async () => {
    authAs(recent);
    const res = await app.request("/api/admin/signins");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 401 when no session is present", async () => {
    authAs(null);
    const res = await app.request("/api/admin/signins");
    expect(res.status).toBe(401);
  });
});
