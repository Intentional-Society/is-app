// Route-level tests for the cron + admin Buttondown sync endpoints.
//
// These tests stand up the real Hono app and exercise its auth /
// secret gates. The sync's effect on Buttondown isn't asserted here
// (the core function has its own tests); these confirm the routes
// reach the runner with the right arguments and reject unauthorized
// callers.

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
import { profilePrograms, profiles, programs, syncLocks } from "@/server/schema";

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

describe("Buttondown sync routes", () => {
  let admin: string;
  let nonAdmin: string;
  const originalApiKey = process.env.BUTTONDOWN_API_KEY;
  const originalCronSecret = process.env.CRON_SECRET;
  const originalWrite = process.env.BUTTONDOWN_SYNC_WRITE;

  beforeEach(async () => {
    admin = randomUUID();
    nonAdmin = randomUUID();
    await insertUserAndProfile(admin, { isAdmin: true });
    await insertUserAndProfile(nonAdmin);
    // Reset env per test so cases that touch the runner are isolated.
    delete process.env.BUTTONDOWN_API_KEY;
    delete process.env.CRON_SECRET;
    delete process.env.BUTTONDOWN_SYNC_WRITE;
    await db.delete(syncLocks);
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    await deleteUserAndProfile(admin);
    await deleteUserAndProfile(nonAdmin);
    process.env.BUTTONDOWN_API_KEY = originalApiKey;
    process.env.CRON_SECRET = originalCronSecret;
    process.env.BUTTONDOWN_SYNC_WRITE = originalWrite;
    await db.delete(syncLocks);
  });

  describe("POST /api/cron/buttondown-sync", () => {
    it("rejects with 401 when no Authorization header", async () => {
      process.env.CRON_SECRET = "secret-abc";
      const res = await app.request("/api/cron/buttondown-sync", { method: "POST" });
      expect(res.status).toBe(401);
    });

    it("rejects with 401 when the bearer does not match CRON_SECRET", async () => {
      process.env.CRON_SECRET = "secret-abc";
      const res = await app.request("/api/cron/buttondown-sync", {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
      });
      expect(res.status).toBe(401);
    });

    it("rejects with 401 when CRON_SECRET is not set in env", async () => {
      // The route must fail closed: even a request with a Bearer
      // header should be rejected if the server has no secret set,
      // otherwise the cron is effectively public.
      const res = await app.request("/api/cron/buttondown-sync", {
        method: "POST",
        headers: { authorization: "Bearer anything" },
      });
      expect(res.status).toBe(401);
    });

    it("returns skipped:api_key_missing when CRON_SECRET matches but BUTTONDOWN_API_KEY is unset", async () => {
      process.env.CRON_SECRET = "secret-abc";
      const res = await app.request("/api/cron/buttondown-sync", {
        method: "POST",
        headers: { authorization: "Bearer secret-abc" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; reason?: string };
      expect(body).toEqual({ status: "skipped", reason: "api_key_missing" });
    });
  });

  describe("POST /api/admin/buttondown-sync/dry-run", () => {
    it("returns 404 for non-admin", async () => {
      authAs(nonAdmin);
      const res = await app.request("/api/admin/buttondown-sync/dry-run", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("returns 401 for unauthenticated", async () => {
      authAs(null);
      const res = await app.request("/api/admin/buttondown-sync/dry-run", { method: "POST" });
      expect(res.status).toBe(401);
    });

    it("for admin, returns skipped:api_key_missing when BUTTONDOWN_API_KEY is unset", async () => {
      authAs(admin);
      const res = await app.request("/api/admin/buttondown-sync/dry-run", { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; reason?: string };
      expect(body).toEqual({ status: "skipped", reason: "api_key_missing" });
    });
  });

  describe("POST /api/admin/buttondown-sync/write", () => {
    it("returns 404 for non-admin", async () => {
      authAs(nonAdmin);
      const res = await app.request("/api/admin/buttondown-sync/write", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("for admin, returns skipped:api_key_missing when BUTTONDOWN_API_KEY is unset", async () => {
      authAs(admin);
      const res = await app.request("/api/admin/buttondown-sync/write", { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("skipped");
    });
  });

  // Inline resync wiring: program join/leave/admin-remove must each
  // run a per-profile Buttondown sync after their DB write, so a tag
  // change shows up within the request instead of waiting for the
  // daily cron. The runner is exercised end-to-end with a stubbed
  // global fetch that records every outbound call.
  describe("inline resync on program changes", () => {
    let memberId: string;
    let programId: string;
    let fetchSpy: ReturnType<typeof vi.fn>;
    const originalFetch = global.fetch;

    const buttondownResponse = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    beforeEach(async () => {
      memberId = randomUUID();
      programId = randomUUID();
      await db.execute(
        sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous)
            VALUES (${memberId}::uuid, ${`${memberId}@testfake.local`}, false, false)`,
      );
      // lastUpdatedProfile is what the sync's loadEligibleProfiles
      // filters on — without it the resync is a no-op.
      await db.insert(profiles).values({ id: memberId, lastUpdatedProfile: new Date() });
      await db.insert(programs).values({
        id: programId,
        slug: `inline-resync-${programId.slice(0, 8)}`,
        name: "Inline resync program",
        buttondownTag: "weekly",
        signupsOpen: true,
      });

      process.env.BUTTONDOWN_API_KEY = "test-key";
      process.env.BUTTONDOWN_SYNC_WRITE = "1";

      // Canned Buttondown responses: 404 on the initial id/email
      // lookup, 201 on create. Enough for the runner to walk a happy
      // path and call createSubscriber, which is what we assert on.
      fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("/v1/subscribers/")) return buttondownResponse(404, { detail: "not found" });
        if (url.endsWith("/v1/subscribers")) {
          return buttondownResponse(201, {
            id: "sub_test",
            email_address: `${memberId}@testfake.local`,
            type: "regular",
            tags: ["weekly", "isweb-member", "new"],
          });
        }
        return buttondownResponse(500, { error: `unexpected url: ${url}` });
      });
      global.fetch = fetchSpy as unknown as typeof fetch;
    });

    afterEach(async () => {
      global.fetch = originalFetch;
      await db.delete(profilePrograms).where(eq(profilePrograms.profileId, memberId));
      await db.delete(programs).where(eq(programs.id, programId));
      await db.delete(profiles).where(eq(profiles.id, memberId));
      await db.execute(sql`DELETE FROM auth.users WHERE id = ${memberId}::uuid`);
    });

    it("POST /api/programs/:id/join hits Buttondown after the DB write", async () => {
      authAs(memberId);
      const res = await app.request(`/api/programs/${programId}/join`, { method: "POST" });
      expect(res.status).toBe(200);

      // At least one fetch landed on Buttondown's subscribers
      // endpoint — the resync ran end-to-end against the real client.
      const buttondownCalls = fetchSpy.mock.calls.filter((args) => {
        const url = typeof args[0] === "string" ? args[0] : (args[0] as URL | Request).toString();
        return url.includes("api.buttondown.com");
      });
      expect(buttondownCalls.length).toBeGreaterThan(0);
      // Specifically: a POST to /subscribers (the create path the
      // member with no prior subscriber should land on).
      const created = fetchSpy.mock.calls.find((args) => {
        const url = typeof args[0] === "string" ? args[0] : (args[0] as URL | Request).toString();
        const method = (args[1] as RequestInit | undefined)?.method ?? "GET";
        return url.endsWith("/v1/subscribers") && method === "POST";
      });
      expect(created).toBeDefined();
    });

    it("inline resync retries the lock after a 500ms delay when briefly held", async () => {
      // Pre-seed a held lock that expires in 200ms — shorter than the
      // 500ms retry delay — so the first acquireLock fails and the
      // second succeeds via the lease-expired steal path. Proves the
      // retry runs end-to-end instead of bailing on the first miss.
      await db.execute(
        sql`INSERT INTO sync_locks (name, locked_until, acquired_by)
            VALUES ('buttondown', now() + interval '200 milliseconds', 'test:hold-briefly')`,
      );

      authAs(memberId);
      const res = await app.request(`/api/programs/${programId}/join`, { method: "POST" });
      expect(res.status).toBe(200);

      // Retry succeeded: a POST /v1/subscribers fired, meaning the
      // sync ran rather than skipping on lock_held.
      const created = fetchSpy.mock.calls.find((args) => {
        const url = typeof args[0] === "string" ? args[0] : (args[0] as URL | Request).toString();
        const method = (args[1] as RequestInit | undefined)?.method ?? "GET";
        return url.endsWith("/v1/subscribers") && method === "POST";
      });
      expect(created).toBeDefined();
    });
  });
});
