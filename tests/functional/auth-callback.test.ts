import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/server/profiles", () => ({
  upsertProfile: vi.fn(),
}));

import { GET } from "@/app/auth/callback/route";
import { createClient } from "@/lib/supabase/server";

const mockCreateClient = vi.mocked(createClient);

const makeRequest = (path: string) =>
  new NextRequest(new URL(path, "http://testfake.local"));

describe("GET /auth/callback", () => {
  beforeEach(() => {
    mockCreateClient.mockReset();
  });

  it("redirects to /login?error=missing_code when the code query param is absent", async () => {
    const res = await GET(makeRequest("/auth/callback"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://testfake.local/login?error=missing_code",
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("redirects to /login?error=exchange_failed when exchangeCodeForSession errors", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: { message: "expired", status: 400 },
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await GET(makeRequest("/auth/callback?code=bad-code"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://testfake.local/login?error=exchange_failed",
    );
  });
});
