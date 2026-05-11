import type { User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";

import { updateSession } from "@/lib/supabase/middleware";
import { decodeUser, encodeUser, SUPABASE_USER_HEADER } from "@/lib/supabase/server-user";

const mockCreateServerClient = vi.mocked(createServerClient);

const mockGetUser = (user: User | null) => {
  mockCreateServerClient.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    // biome-ignore lint/suspicious/noExplicitAny: test mock shape
  } as any);
};

const fakeUser: User = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "real@example.com",
  app_metadata: {},
  user_metadata: { displayName: "Real" },
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00Z",
} as User;

const attackerUser: User = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "attacker@example.com",
  app_metadata: {},
  user_metadata: { displayName: "Attacker" },
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00Z",
} as User;

describe("Supabase proxy middleware (updateSession)", () => {
  beforeEach(() => {
    mockCreateServerClient.mockReset();
  });

  it("forwards the validated User on SUPABASE_USER_HEADER when a session is present", async () => {
    mockGetUser(fakeUser);
    const request = new NextRequest("http://localhost/foo");

    const response = await updateSession(request);

    // Downstream sees the validated user on the forwarded request.
    const forwarded = response.headers.get("x-middleware-override-headers");
    expect(forwarded).toContain(SUPABASE_USER_HEADER);
    const overrideValue = response.headers.get(`x-middleware-request-${SUPABASE_USER_HEADER}`);
    expect(decodeUser(overrideValue)?.id).toBe(fakeUser.id);
  });

  it("strips an inbound forged SUPABASE_USER_HEADER even when no session is present", async () => {
    mockGetUser(null);
    const request = new NextRequest("http://localhost/foo", {
      headers: { [SUPABASE_USER_HEADER]: encodeUser(attackerUser) },
    });

    await updateSession(request);

    // The inbound forgery must NOT survive to the downstream handler.
    // After delete, request.headers should no longer carry the header.
    expect(request.headers.get(SUPABASE_USER_HEADER)).toBeNull();
  });

  it("overwrites an inbound forged header with the real validated user", async () => {
    mockGetUser(fakeUser);
    const request = new NextRequest("http://localhost/foo", {
      headers: { [SUPABASE_USER_HEADER]: encodeUser(attackerUser) },
    });

    await updateSession(request);

    // The header on the (mutated) request now carries the validated
    // user, not the attacker's spoof.
    expect(decodeUser(request.headers.get(SUPABASE_USER_HEADER))?.id).toBe(fakeUser.id);
  });
});
