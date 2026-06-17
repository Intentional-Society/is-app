import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";

import { supabaseAdmin } from "@/lib/supabase/admin";
import app from "@/server/api";
import { AVATAR_BUCKET, MAX_AVATAR_UPLOAD_BYTES } from "@/server/avatars";
import { db } from "@/server/db";
import { profiles } from "@/server/schema";

const mockCreateServerClient = vi.mocked(createServerClient);

const TEST_EMAIL = "avatar-test@testfake.local";

const makeUser = (id: string): User =>
  ({
    id,
    email: TEST_EMAIL,
    user_metadata: { displayName: "Avatar Tester" },
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  }) as User;

const mockAuth = (user: User | null) => {
  mockCreateServerClient.mockReturnValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    // biome-ignore lint/suspicious/noExplicitAny: test mock shape
  } as any);
};

// A genuinely-decodable image, built by sharp so the endpoint's own
// sharp decode succeeds.
const makeImage = (): Promise<Buffer> =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 120, g: 80, b: 200 } } })
    .png()
    .toBuffer();

const postAvatar = (bytes: Uint8Array, type: string) => {
  const form = new FormData();
  // Re-wrap so the Blob part is plain-ArrayBuffer-backed (satisfies BlobPart).
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), "upload");
  return app.request("/api/me/avatar", { method: "POST", body: form });
};

const objectsFor = async (userId: string): Promise<string[]> => {
  const { data } = await supabaseAdmin.storage.from(AVATAR_BUCKET).list(userId);
  return (data ?? []).map((o) => o.name);
};

describe("POST/DELETE /api/me/avatar", () => {
  let userId: string;

  beforeAll(async () => {
    // Idempotent — the bucket is normally provisioned from config.toml,
    // but creating it here keeps the suite robust on an already-running
    // local stack. The "already exists" error is expected and ignored.
    await supabaseAdmin.storage.createBucket(AVATAR_BUCKET, {
      public: false,
      fileSizeLimit: "1MB",
      allowedMimeTypes: ["image/webp"],
    });
  });

  beforeEach(async () => {
    userId = randomUUID();
    // This suite owns the TEST_EMAIL namespace in auth.users. Clear
    // any residue from a prior run that didn't fully clean up (e.g.,
    // the runner was killed mid-test) so the unique-email constraint
    // doesn't poison this run. profiles → auth.users FK is RESTRICT,
    // so drop the profile row first.
    await db.execute(
      sql`DELETE FROM public.profiles WHERE id IN (SELECT id FROM auth.users WHERE email = ${TEST_EMAIL})`,
    );
    await db.execute(sql`DELETE FROM auth.users WHERE email = ${TEST_EMAIL}`);
    await db.execute(
      sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${userId}::uuid, ${TEST_EMAIL}, false, false)`,
    );
    await db.insert(profiles).values({ id: userId, displayName: "Avatar Tester" });
    mockAuth(makeUser(userId));
  });

  afterEach(async () => {
    mockCreateServerClient.mockReset();
    const names = await objectsFor(userId);
    if (names.length > 0) {
      await supabaseAdmin.storage.from(AVATAR_BUCKET).remove(names.map((n) => `${userId}/${n}`));
    }
    await db.delete(profiles).where(eq(profiles.id, userId));
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`);
  });

  it("stores an uploaded image and points the profile row at it", async () => {
    const res = await postAvatar(await makeImage(), "image/png");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { avatarUrl: string };
    expect(body.avatarUrl).toMatch(/^https?:\/\//);

    const [row] = await db.select({ avatarPath: profiles.avatarPath }).from(profiles).where(eq(profiles.id, userId));
    expect(row.avatarPath).toMatch(new RegExp(`^${userId}/[0-9a-f-]+\\.webp$`));
    expect(await objectsFor(userId)).toHaveLength(1);
  });

  it("accepts a JPEG upload (the browser webp-fallback path) and stores it as webp", async () => {
    // When a browser can't encode WebP via canvas.toBlob, the client
    // falls back to JPEG (avatar-uploader.tsx). The server must accept
    // it and canonicalize to the same 1024² webp object as any other.
    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 200, b: 90 } } })
      .jpeg()
      .toBuffer();
    const res = await postAvatar(jpeg, "image/jpeg");

    expect(res.status).toBe(200);
    const [row] = await db.select({ avatarPath: profiles.avatarPath }).from(profiles).where(eq(profiles.id, userId));
    expect(row.avatarPath).toMatch(new RegExp(`^${userId}/[0-9a-f-]+\\.webp$`));
  });

  it("rejects a non-image content type", async () => {
    const res = await postAvatar(new TextEncoder().encode("not an image"), "text/plain");
    expect(res.status).toBe(400);
  });

  it("rejects bytes that do not decode as an image", async () => {
    // Passes the content-type check, but sharp can't decode it.
    const res = await postAvatar(new TextEncoder().encode("still not an image"), "image/png");
    expect(res.status).toBe(400);
  });

  it("rejects an oversize upload", async () => {
    const tooBig = new Uint8Array(MAX_AVATAR_UPLOAD_BYTES + 1);
    const res = await postAvatar(tooBig, "image/webp");
    expect(res.status).toBe(400);
  });

  it("rejects an unauthenticated request", async () => {
    mockAuth(null);
    const res = await postAvatar(await makeImage(), "image/png");
    expect(res.status).toBe(401);
  });

  it("replacing an avatar removes the previous object", async () => {
    await postAvatar(await makeImage(), "image/png");
    const [first] = await db.select({ avatarPath: profiles.avatarPath }).from(profiles).where(eq(profiles.id, userId));

    await postAvatar(await makeImage(), "image/png");
    const [second] = await db.select({ avatarPath: profiles.avatarPath }).from(profiles).where(eq(profiles.id, userId));

    expect(second.avatarPath).not.toBe(first.avatarPath);
    // Exactly one object remains — the previous one was cleaned up.
    expect(await objectsFor(userId)).toHaveLength(1);
  });

  it("DELETE clears the column and removes the object", async () => {
    await postAvatar(await makeImage(), "image/png");

    const res = await app.request("/api/me/avatar", { method: "DELETE" });
    expect(res.status).toBe(200);

    const [row] = await db.select({ avatarPath: profiles.avatarPath }).from(profiles).where(eq(profiles.id, userId));
    expect(row.avatarPath).toBeNull();
    expect(await objectsFor(userId)).toHaveLength(0);
  });
});
