import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";

import app from "@/server/api";
import { PUBLIC_PATHS } from "@/server/auth-middleware";

const mockCreateServerClient = vi.mocked(createServerClient);

const mockGetUser = (user: User | null) => {
  mockCreateServerClient.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
};

const fakeUser: User = {
  id: "00000000-0000-0000-0000-000000000001",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00Z",
} as User;

describe("API auth middleware", () => {
  beforeEach(() => {
    mockCreateServerClient.mockReset();
  });

  it("returns 401 on protected routes when no session is present", async () => {
    mockGetUser(null);

    const res = await app.request("/api/hello");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("runs the handler when a session is present", async () => {
    mockGetUser(fakeUser);

    const res = await app.request("/api/hello");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: "Hello from Intentional Society API",
    });
  });

  it("allows /api/health without a session", async () => {
    mockGetUser(null);

    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    // The Supabase client should never even be built for a public route.
    expect(mockCreateServerClient).not.toHaveBeenCalled();
  });

  it("exposes only the expected public paths", () => {
    // Regression guard: if a new route needs to bypass auth, it should
    // be added here intentionally — and that change will be visible in
    // this test's diff.
    expect(PUBLIC_PATHS).toEqual([
      "/api/health",
      /^\/api\/invites\/[^/]+\/check$/,
    ]);
  });

  it("allows /api/invites/:code/check without a session", async () => {
    mockGetUser(null);

    // The handler itself isn't wired yet in this test — 404 is fine.
    // What matters is that auth didn't short-circuit with a 401.
    const res = await app.request("/api/invites/ABC123/check");

    expect(res.status).not.toBe(401);
    expect(mockCreateServerClient).not.toHaveBeenCalled();
  });
});
