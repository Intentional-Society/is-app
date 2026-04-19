import type { User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { profiles } from "./schema";

export const upsertProfile = async (user: User) => {
  const displayName =
    (user.user_metadata?.displayName as string | undefined) ?? null;

  await db
    .insert(profiles)
    .values({ id: user.id, displayName })
    .onConflictDoNothing({ target: profiles.id });
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

export const getProfileForSelf = async (
  userId: string,
): Promise<ProfileForSelf | null> => {
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
};

// Placeholder. The member-directory endpoint is not built yet; throwing
// here forces the access-control shape to be decided the moment that
// work starts, instead of silently reusing the self shape.
export const getProfileForMember = async (
  _userId: string,
): Promise<never> => {
  throw new Error("NotImplemented: getProfileForMember");
};

// Placeholder. Same rationale as getProfileForMember — admin tooling
// will choose its own shape when it lands.
export const getProfileForAdmin = async (_userId: string): Promise<never> => {
  throw new Error("NotImplemented: getProfileForAdmin");
};
