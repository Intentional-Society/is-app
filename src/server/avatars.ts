import { randomUUID } from "node:crypto";
import { getCache } from "@vercel/functions";
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
// trusted from our cache. Re-signing rotates the URL's `?token=`, which
// is part of next/image's optimizer cache key — so every rotation forces
// a full re-fetch of each avatar's source object from Storage (the egress
// driver behind #382). A 5-day TTL keeps rotation rare; pair it with a
// high `images.minimumCacheTTL` so a variant is never re-fetched within a
// URL's life. Short enough that a leaked avatar URL still dies within the
// week. The cache window sits an hour under the TTL so a URL is re-signed
// before it can expire mid-use.
const SIGN_TTL_SECONDS = 5 * 24 * 60 * 60;
const CACHE_TTL_SECONDS = SIGN_TTL_SECONDS - 60 * 60;

// Signed-URL cache. Vercel Runtime Cache rather than a module-level Map:
// a Map is scoped to one Fluid Compute instance and one deployment, so
// instance recycling, scale-out, and every push-to-main deploy discard
// it — and each loss re-signs the same object path with a fresh
// `?token=`, which is part of the browser's and the image optimizer's
// cache key, forcing both to re-download bytes they already had. (A
// 2026-07-03 HAR capture showed one navigation re-downloading all 12 of
// a program's avatars against tokens minted 8 minutes apart; #382.)
// Runtime Cache is shared across a region's instances and survives
// deploys. getCache() resolves its backing store lazily per operation,
// so binding it at module scope is safe; where the runtime store is
// unavailable (`next dev`, vitest) it falls back to a per-process
// in-memory cache — the old Map behavior.
const cache = getCache({ namespace: "avatar-url" });

// Cache reads and writes are best-effort, like signing itself: a cache
// outage must cost us a re-sign, never a failed page.
const cacheGet = async (path: string): Promise<string | null> => {
  try {
    return ((await cache.get(path)) as string | null) ?? null;
  } catch {
    return null;
  }
};

const cacheSet = async (path: string, url: string): Promise<void> => {
  try {
    await cache.set(path, url, { ttl: CACHE_TTL_SECONDS, tags: ["avatar-url"] });
  } catch {
    // A lost write just means a future re-sign.
  }
};

// Signs a batch of avatar object paths, returning a path → signed-URL
// map. Cache hits skip the network; misses are signed in a single
// `createSignedUrls` round-trip however many there are. Null/undefined
// inputs and objects that fail to sign (e.g. already deleted) are
// simply absent from the result.
export const resolveAvatarUrls = async (
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  const uniquePaths = [...new Set(paths.filter((p): p is string => !!p))];
  if (uniquePaths.length === 0) return result;

  const getStart = performance.now();
  const cached = await Promise.all(uniquePaths.map((path) => cacheGet(path)));
  const cacheGetMs = Math.round(performance.now() - getStart);

  const misses: string[] = [];
  uniquePaths.forEach((path, i) => {
    const url = cached[i];
    if (url) result.set(path, url);
    else misses.push(path);
  });

  let signMs = 0;
  let signFailed = false;
  if (misses.length > 0) {
    const signStart = performance.now();
    const { data, error } = await supabaseAdmin.storage.from(AVATAR_BUCKET).createSignedUrls(misses, SIGN_TTL_SECONDS);
    signMs = Math.round(performance.now() - signStart);
    if (error) {
      // Signing is best-effort. A transient Storage error — most often a
      // 429 "too many connections" when a burst of renders all sign at
      // once — must not 500 a page over a decorative avatar. Report it,
      // then leave the misses unsigned so they fall back to initials.
      signFailed = true;
      log.error("avatar sign failed", {
        count: misses.length,
        message: error.message,
        statusCode: (error as { statusCode?: string }).statusCode,
      });
    } else {
      const sets: Promise<void>[] = [];
      for (const row of data ?? []) {
        if (row.error || !row.path || !row.signedUrl) continue;
        result.set(row.path, row.signedUrl);
        sets.push(cacheSet(row.path, row.signedUrl));
      }
      await Promise.all(sets);
    }
  }

  // One event per resolve. The hit rate is the ground truth on whether the
  // shared cache is working (persistently low in prod means it isn't and
  // we're back to per-instance signing churn); cacheGetMs/signMs bound what
  // the lookup and the signing round-trip cost the request.
  log.info("avatar url cache", {
    batch: uniquePaths.length,
    hits: uniquePaths.length - misses.length,
    misses: misses.length,
    cacheGetMs,
    signMs,
    signFailed,
  });

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
