import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { log } from "next-axiom";
import sharp from "sharp";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { db } from "./db";
import { profiles } from "./schema";

// Supabase Storage bucket holding avatar objects. Private — objects
// are reachable only via a signed URL (see
// docs/design-profile-pictures.md decision 1).
export const AVATAR_BUCKET = "avatars";

// TTL handed to Supabase when signing, and how long a signed URL is
// trusted from our cache. The cache window is deliberately shorter
// than the TTL so a URL is re-signed before it can expire mid-use.
const SIGN_TTL_SECONDS = 24 * 60 * 60;
const CACHE_TTL_MS = 23 * 60 * 60 * 1000;

type CacheEntry = { url: string; expiresAt: number };

// Module-level cache keyed by object path. On Fluid Compute the
// instance is reused across requests, so signing fires roughly once
// per path per TTL rather than once per page view — the directory's
// hot path then does zero Storage round-trips.
const signedUrlCache = new Map<string, CacheEntry>();

// Signs a batch of avatar object paths, returning a path → signed-URL
// map. Cache hits skip the network; misses are signed in a single
// `createSignedUrls` round-trip however many there are. Null/undefined
// inputs and objects that fail to sign (e.g. already deleted) are
// simply absent from the result.
export const resolveAvatarUrls = async (
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  const now = Date.now();
  const misses: string[] = [];

  for (const path of paths) {
    if (!path || result.has(path)) continue;
    const cached = signedUrlCache.get(path);
    if (cached && cached.expiresAt > now) {
      result.set(path, cached.url);
    } else if (!misses.includes(path)) {
      misses.push(path);
    }
  }

  if (misses.length > 0) {
    const { data, error } = await supabaseAdmin.storage.from(AVATAR_BUCKET).createSignedUrls(misses, SIGN_TTL_SECONDS);
    if (error) {
      // Signing is best-effort. A transient Storage error — most often a
      // 429 "too many connections" when a burst of renders all sign at
      // once — must not 500 a page over a decorative avatar. Report it,
      // then leave the misses unsigned so they fall back to initials.
      log.error("avatar sign failed", {
        count: misses.length,
        message: error.message,
        statusCode: (error as { statusCode?: string }).statusCode,
      });
      return result;
    }
    for (const row of data ?? []) {
      if (row.error || !row.path || !row.signedUrl) continue;
      signedUrlCache.set(row.path, { url: row.signedUrl, expiresAt: now + CACHE_TTL_MS });
      result.set(row.path, row.signedUrl);
    }
  }

  return result;
};

// Replaces the stored `avatarPath` on each row with a freshly signed
// `avatarUrl`. This is the single chokepoint where a stored path
// becomes a URL, so a future change of serving scheme stays a
// one-function edit — and it guarantees the raw path never reaches a
// client. Single-row callers pass a one-element array.
export const attachAvatarUrls = async <T extends { avatarPath: string | null }>(
  rows: readonly T[],
): Promise<(Omit<T, "avatarPath"> & { avatarUrl: string | null })[]> => {
  const signed = await resolveAvatarUrls(rows.map((r) => r.avatarPath));
  return rows.map(({ avatarPath, ...rest }) => ({
    ...rest,
    avatarUrl: avatarPath ? (signed.get(avatarPath) ?? null) : null,
  }));
};

// Maximum accepted upload size. The browser shrinks the image well
// below this; the cap is defence-in-depth against a client that does
// not (see docs/design-profile-pictures.md decision 3).
export const MAX_AVATAR_UPLOAD_BYTES = 1_000_000;

const AVATAR_DIMENSION = 1024;

// Re-encodes arbitrary uploaded image bytes into the canonical avatar
// artifact: a 1024² WebP, cover-cropped square, EXIF orientation
// applied, all metadata stripped. Rejects (throws) bytes that do not
// decode as an image — the caller maps that to a 400. limitInputPixels
// caps the decoded surface as a decompression-bomb guard.
export const encodeAvatar = (input: Buffer): Promise<Buffer> =>
  sharp(input, { limitInputPixels: 100_000_000 })
    .rotate()
    .resize(AVATAR_DIMENSION, AVATAR_DIMENSION, { fit: "cover" })
    .webp({ quality: 88 })
    .toBuffer();

// Stores an encoded avatar for a user: uploads the object, points the
// profile row at it, then removes the previous object. The ordering is
// deliberate — the object exists before the row references it, and the
// old object is dropped last — so a mid-failure only ever orphans a
// file, never leaves a row pointing at a missing object. Returns the
// new signed URL. Assumes the profile row already exists.
export const replaceAvatar = async (userId: string, webp: Buffer): Promise<string> => {
  const path = `${userId}/${randomUUID()}.webp`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(AVATAR_BUCKET)
    .upload(path, webp, { contentType: "image/webp", upsert: false });
  if (uploadError) throw uploadError;

  const [existing] = await db.select({ avatarPath: profiles.avatarPath }).from(profiles).where(eq(profiles.id, userId));
  // Single autocommit statement — safe on the transaction pooler.
  await db.update(profiles).set({ avatarPath: path }).where(eq(profiles.id, userId));

  if (existing?.avatarPath && existing.avatarPath !== path) {
    await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([existing.avatarPath]);
  }

  return (await resolveAvatarUrls([path])).get(path) ?? "";
};

// Clears a user's avatar: nulls the column, then removes the object.
export const clearAvatar = async (userId: string): Promise<void> => {
  const [existing] = await db.select({ avatarPath: profiles.avatarPath }).from(profiles).where(eq(profiles.id, userId));
  if (!existing?.avatarPath) return;

  await db.update(profiles).set({ avatarPath: null }).where(eq(profiles.id, userId));
  await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([existing.avatarPath]);
};
