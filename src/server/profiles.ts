import type { User } from "@supabase/supabase-js";
import { asc, eq, isNotNull, or } from "drizzle-orm";
import { cache } from "react";

import { db } from "./db";
import { profiles } from "./schema";

export const EDITABLE_PROFILE_FIELDS = [
  "displayName",
  "bio",
  "keywords",
  "location",
  "supplementaryInfo",
  "avatarUrl",
  "emergencyContact",
  "liveDesire",
] as const;

type EditableField = (typeof EDITABLE_PROFILE_FIELDS)[number];

export type EditableProfileInput = Partial<{
  displayName: string | null;
  bio: string | null;
  keywords: string[];
  location: string | null;
  supplementaryInfo: string | null;
  avatarUrl: string | null;
  emergencyContact: string | null;
  liveDesire: string | null;
}>;

const isNullableString = (v: unknown): v is string | null => v === null || typeof v === "string";

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

// Returns the sanitized update payload, or a string describing the
// first validation failure. Unknown keys are treated as failures to
// protect fields like isAdmin / referredBy from being set via the
// editable endpoint.
export const parseEditableProfile = (body: unknown): EditableProfileInput | { error: string } => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }

  const input = body as Record<string, unknown>;
  const out: EditableProfileInput = {};

  for (const key of Object.keys(input)) {
    if (!(EDITABLE_PROFILE_FIELDS as readonly string[]).includes(key)) {
      return { error: `unknown or non-editable field: ${key}` };
    }
  }

  for (const key of EDITABLE_PROFILE_FIELDS) {
    if (!(key in input)) continue;
    const value = input[key];
    if (key === "keywords") {
      if (!isStringArray(value)) {
        return { error: "keywords must be an array of strings" };
      }
      out.keywords = value;
    } else {
      if (!isNullableString(value)) {
        return { error: `${key} must be a string or null` };
      }
      out[key as Exclude<EditableField, "keywords">] = value;
    }
  }

  return out;
};

export const toSlug = (displayName: string): string =>
  displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const upsertProfile = async (user: User) => {
  const displayName = (user.user_metadata?.displayName as string | undefined) ?? null;
  const slug = displayName ? toSlug(displayName) : null;

  await db.insert(profiles).values({ id: user.id, displayName, slug }).onConflictDoNothing({ target: profiles.id });
};

export type ProfileForSelf = {
  id: string;
  displayName: string | null;
  bio: string | null;
  keywords: string[];
  location: string | null;
  supplementaryInfo: string | null;
  referredBy: string | null;
  referredByLegacy: string | null;
  avatarUrl: string | null;
  emergencyContact: string | null;
  liveDesire: string | null;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// Per-request memoization: the root layout fetches the profile to show
// displayName in the header, and `/` fetches it again for the bio-null
// /welcome redirect gate. Without cache(), that's two DB roundtrips on
// every signed-in render — enough to push Vercel-preview cold-starts
// past e2e's 10s waitForURL budget. cache() keys on the arg tuple, so
// only co-located callers with the same userId share the result.
export const getProfileForSelf = cache(async (userId: string): Promise<ProfileForSelf | null> => {
  const [row] = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      bio: profiles.bio,
      keywords: profiles.keywords,
      location: profiles.location,
      supplementaryInfo: profiles.supplementaryInfo,
      referredBy: profiles.referredBy,
      referredByLegacy: profiles.referredByLegacy,
      avatarUrl: profiles.avatarUrl,
      emergencyContact: profiles.emergencyContact,
      liveDesire: profiles.liveDesire,
      isAdmin: profiles.isAdmin,
      createdAt: profiles.createdAt,
      updatedAt: profiles.updatedAt,
    })
    .from(profiles)
    .where(eq(profiles.id, userId));

  return row ?? null;
});

export type ProfileForMember = {
  id: string;
  slug: string | null;
  displayName: string | null;
  bio: string | null;
  keywords: string[];
  location: string | null;
  supplementaryInfo: string | null;
  avatarUrl: string | null;
  liveDesire: string | null;
  createdAt: Date;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Accepts either a UUID or a slug so /members/aria-chen and
// /members/<uuid> both work. UUID-shaped strings go straight to the id
// column; anything else is treated as a slug lookup.
export const getProfileForMember = async (idOrSlug: string): Promise<ProfileForMember | null> => {
  const where = UUID_RE.test(idOrSlug)
    ? or(eq(profiles.id, idOrSlug), eq(profiles.slug, idOrSlug))
    : eq(profiles.slug, idOrSlug);

  const [row] = await db
    .select({
      id: profiles.id,
      slug: profiles.slug,
      displayName: profiles.displayName,
      bio: profiles.bio,
      keywords: profiles.keywords,
      location: profiles.location,
      supplementaryInfo: profiles.supplementaryInfo,
      avatarUrl: profiles.avatarUrl,
      liveDesire: profiles.liveDesire,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .where(where);

  return row ?? null;
};

export type MemberSummary = {
  id: string;
  slug: string | null;
  displayName: string;
  location: string | null;
  keywords: string[];
  avatarUrl: string | null;
};

export const listMembers = async (): Promise<MemberSummary[]> => {
  return db
    .select({
      id: profiles.id,
      slug: profiles.slug,
      displayName: profiles.displayName,
      location: profiles.location,
      keywords: profiles.keywords,
      avatarUrl: profiles.avatarUrl,
    })
    .from(profiles)
    .where(isNotNull(profiles.displayName))
    .orderBy(asc(profiles.displayName)) as Promise<MemberSummary[]>;
};

// Placeholder. Same rationale as getProfileForMember — admin tooling
// will choose its own shape when it lands.
export const getProfileForAdmin = async (): Promise<never> => {
  throw new Error("NotImplemented: getProfileForAdmin");
};
