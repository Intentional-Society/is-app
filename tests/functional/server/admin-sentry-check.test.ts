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

const authAs = (userId: string) => {
  mockCreateServerClient.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId, email: `${userId}@testfake.local` } as User },
        error: null,
      }),
    },
    // biome-ignore lint/suspicious/noExplicitAny: test mock shape
  } as any);
};

// Runs against the real, unmocked Sentry SDK. Tests never load
// instrumentation.ts, so no client exists: the same state the probe is
// built to detect in production.
describe("GET /api/admin/sentry-check", () => {
  let adminId: string;
  let memberId: string;

  beforeEach(async () => {
    adminId = randomUUID();
    memberId = randomUUID();
    for (const [id, isAdmin] of [
      [adminId, true],
      [memberId, false],
    ] as const) {
      await db.execute(
        sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${`${id}@testfake.local`}, false, false)`,
      );
      await db.insert(profiles).values({ id, isAdmin });
    }
  });

  afterEach(async () => {
    for (const id of [adminId, memberId]) {
      await db.delete(profiles).where(eq(profiles.id, id));
      await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
    }
  });

  it("is hidden from non-admins", async () => {
    authAs(memberId);
    const res = await app.request("/api/admin/sentry-check?send=1");
    expect(res.status).toBe(404);
  });

  it("reports an uninitialized SDK, and ?send=1 reports a failed flush without throwing", async () => {
    authAs(adminId);
    const res = await app.request("/api/admin/sentry-check?send=1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ clientInitialized: false, enabled: null, dsnHost: null });
    expect(body.test).toEqual({ eventId: expect.any(String), flushed: false });
  });
});
