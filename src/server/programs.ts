import { and, eq, sql } from "drizzle-orm";

import { db } from "./db";
import { profilePrograms, profiles, programs } from "./schema";

export type ProgramWithMembership = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  memberCount: number;
  joined: boolean;
  joinedAt: string | null;
};

// Note: memberCount and joinedAt use correlated subqueries which is
// fine for a small number of programs. If the programs table grows
// significantly, refactor to LEFT JOIN + GROUP BY with a conditional
// aggregate for the current user's assigned_at.
export const listPrograms = async (
  userId: string,
): Promise<ProgramWithMembership[]> => {
  const rows = await db
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      description: programs.description,
      memberCount: sql<number>`(
        SELECT count(*)::int FROM ${profilePrograms}
        WHERE ${profilePrograms.programId} = ${programs.id}
      )`,
      joinedAt: sql<string | null>`(
        SELECT to_json(${profilePrograms.assignedAt}) #>> '{}' FROM ${profilePrograms}
        WHERE ${profilePrograms.programId} = ${programs.id}
          AND ${profilePrograms.profileId} = ${userId}
      )`,
    })
    .from(programs)
    .orderBy(programs.name);

  return rows.map((r) => ({
    ...r,
    joined: r.joinedAt !== null,
  }));
};

// Ensures the profile row exists before inserting into profile_programs,
// matching the self-heal pattern used by GET /api/me. Without this,
// the FK from profile_programs.profile_id → profiles.id would throw
// if a session exists but the profile upsert in /auth/callback failed.
const ensureProfile = async (userId: string): Promise<void> => {
  const [existing] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, userId));

  if (!existing) {
    await db
      .insert(profiles)
      .values({ id: userId })
      .onConflictDoNothing();
  }
};

export const joinProgram = async (
  userId: string,
  programId: string,
): Promise<{ ok: true } | { error: "not_found" | "already_joined" }> => {
  // Verify program exists
  const [program] = await db
    .select({ id: programs.id })
    .from(programs)
    .where(eq(programs.id, programId));

  if (!program) return { error: "not_found" };

  // Self-heal: ensure profile row exists before FK insert
  await ensureProfile(userId);

  // Insert membership — conflict means already joined
  const result = await db
    .insert(profilePrograms)
    .values({ profileId: userId, programId })
    .onConflictDoNothing()
    .returning({ profileId: profilePrograms.profileId });

  if (result.length === 0) return { error: "already_joined" };

  return { ok: true };
};

export const leaveProgram = async (
  userId: string,
  programId: string,
): Promise<{ ok: true } | { error: "not_found" }> => {
  const result = await db
    .delete(profilePrograms)
    .where(
      and(
        eq(profilePrograms.profileId, userId),
        eq(profilePrograms.programId, programId),
      ),
    )
    .returning({ profileId: profilePrograms.profileId });

  if (result.length === 0) return { error: "not_found" };

  return { ok: true };
};
