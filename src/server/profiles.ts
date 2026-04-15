import type { User } from "@supabase/supabase-js";

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
