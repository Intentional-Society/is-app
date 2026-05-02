import { and, eq, sql } from "drizzle-orm";

import { db } from "./db";
import { profilePrograms, programs } from "./schema";

export type ProgramWithMembership = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  memberCount: number;
  joined: boolean;
  joinedAt: string | null;
};

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
        SELECT ${profilePrograms.assignedAt}::text FROM ${profilePrograms}
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
