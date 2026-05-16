import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

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
    if (error) throw error;
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
