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

const makeUser = (id: string, email: string): User =>
  ({
    id,
    email,
    user_metadata: { displayName: "Test User" },
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  }) as User;

describe("GET /api/me", () => {
  let testUserId: string;

  beforeEach(async () => {
    testUserId = randomUUID();
    await db.execute(
      sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${testUserId}::uuid, 'me-test@testfake.local', false, false)`,
    );

    mockCreateServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: makeUser(testUserId, "me-test@testfake.local") },
          error: null,
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await db.delete(profiles).where(eq(profiles.id, testUserId));
    await db.execute(
      sql`DELETE FROM auth.users WHERE id = ${testUserId}::uuid`,
    );
  });

  it("returns the self shape and self-heals a missing profile row", async () => {
    // No profile pre-inserted — handler must upsert on first call.
    const res = await app.request("/api/me");

    expect(res.status).toBe(200);
    const body = await res.json();

    // Strict equality: the self shape is explicit. Any accidental
    // field addition or omission will fail this assertion loudly.
    // Programs intentionally absent — they're not a profile field.
    expect(body).toEqual({
      id: testUserId,
      email: "me-test@testfake.local",
      profile: {
        id: testUserId,
        displayName: "Test User",
        bio: null,
        keywords: [],
        location: null,
        supplementaryInfo: null,
        referredBy: null,
        referredByLegacy: null,
        avatarUrl: null,
        emergencyContact: null,
        liveDesire: null,
        isAdmin: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });

    // Confirm the self-heal actually wrote a row.
    const rows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, testUserId));
    expect(rows).toHaveLength(1);
  });
});
