import { and, count, desc, eq } from "drizzle-orm";

import { db } from "./db";
import { profilePrograms, profiles, programs } from "./schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (s: string): boolean => UUID_RE.test(s);

const programSlug = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export type AdminProgram = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdBy: string | null;
  memberCount: number;
  createdAt: string;
};

export type AdminProgramMember = {
  id: string;
  displayName: string | null;
  slug: string | null;
  avatarUrl: string | null;
  assignedAt: string;
};

export const listAdminPrograms = async (): Promise<AdminProgram[]> => {
  const rows = await db
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      description: programs.description,
      isActive: programs.isActive,
      createdBy: programs.createdBy,
      createdAt: programs.createdAt,
    })
    .from(programs)
    .orderBy(desc(programs.createdAt));

  const counts = await db
    .select({ programId: profilePrograms.programId, n: count() })
    .from(profilePrograms)
    .groupBy(profilePrograms.programId);

  const countMap = new Map(counts.map((c) => [c.programId, c.n]));

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    memberCount: countMap.get(r.id) ?? 0,
  }));
};

export const createProgram = async (data: {
  name: string;
  description: string | null;
  slug?: string | null;
  isActive?: boolean;
  createdBy: string;
}): Promise<
  { id: string; slug: string } | { error: "invalid_name" | "slug_taken" }
> => {
  const name = data.name.trim();
  if (!name) return { error: "invalid_name" };

  const slug = data.slug?.trim() || programSlug(name);

  const [existing] = await db
    .select({ id: programs.id })
    .from(programs)
    .where(eq(programs.slug, slug));
  if (existing) return { error: "slug_taken" };

  const [created] = await db
    .insert(programs)
    .values({
      name,
      description: data.description,
      slug,
      isActive: data.isActive ?? true,
      createdBy: data.createdBy,
    })
    .returning({ id: programs.id, slug: programs.slug });

  return created;
};

export const updateProgram = async (
  id: string,
  data: { name?: string; description?: string | null; slug?: string | null; isActive?: boolean },
): Promise<
  { ok: true } | { error: "not_found" | "invalid_name" | "slug_taken" }
> => {
  if (!isValidUuid(id)) return { error: "not_found" };

  const [existing] = await db
    .select({ id: programs.id, slug: programs.slug })
    .from(programs)
    .where(eq(programs.id, id));
  if (!existing) return { error: "not_found" };

  if (data.name !== undefined && !data.name.trim()) return { error: "invalid_name" };

  const update: { name?: string; description?: string | null; slug?: string; isActive?: boolean } = {};
  if (data.name !== undefined) update.name = data.name.trim();
  if (data.description !== undefined) update.description = data.description;
  if (data.isActive !== undefined) update.isActive = data.isActive;

  // Explicit slug override takes priority; else auto-generate from name change
  const targetSlug =
    data.slug?.trim() || (data.name ? programSlug(data.name.trim()) : null);
  if (targetSlug && targetSlug !== existing.slug) {
    const [conflict] = await db
      .select({ id: programs.id })
      .from(programs)
      .where(eq(programs.slug, targetSlug));
    if (conflict) return { error: "slug_taken" };
    update.slug = targetSlug;
  }

  if (Object.keys(update).length > 0) {
    await db.update(programs).set(update).where(eq(programs.id, id));
  }

  return { ok: true };
};

export const deleteProgram = async (
  id: string,
): Promise<
  { ok: true } | { error: "not_found" | "has_members"; memberCount?: number }
> => {
  if (!isValidUuid(id)) return { error: "not_found" };

  const [program] = await db
    .select({ id: programs.id })
    .from(programs)
    .where(eq(programs.id, id));
  if (!program) return { error: "not_found" };

  const [{ memberCount }] = await db
    .select({ memberCount: count() })
    .from(profilePrograms)
    .where(eq(profilePrograms.programId, id));

  if (memberCount > 0) return { error: "has_members", memberCount };

  await db.delete(programs).where(eq(programs.id, id));
  return { ok: true };
};

export const listProgramMembers = async (
  programId: string,
): Promise<AdminProgramMember[] | { error: "not_found" }> => {
  if (!isValidUuid(programId)) return { error: "not_found" };

  const [program] = await db
    .select({ id: programs.id })
    .from(programs)
    .where(eq(programs.id, programId));
  if (!program) return { error: "not_found" };

  const rows = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      slug: profiles.slug,
      avatarUrl: profiles.avatarUrl,
      assignedAt: profilePrograms.assignedAt,
    })
    .from(profilePrograms)
    .innerJoin(profiles, eq(profilePrograms.profileId, profiles.id))
    .where(eq(profilePrograms.programId, programId))
    .orderBy(profiles.displayName);

  return rows.map((r) => ({ ...r, assignedAt: r.assignedAt.toISOString() }));
};

export const assignMember = async (
  programId: string,
  profileId: string,
): Promise<{ ok: true } | { error: "not_found" | "already_assigned" }> => {
  if (!isValidUuid(programId) || !isValidUuid(profileId))
    return { error: "not_found" };

  const [prog] = await db
    .select({ id: programs.id })
    .from(programs)
    .where(eq(programs.id, programId));
  if (!prog) return { error: "not_found" };

  const [member] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, profileId));
  if (!member) return { error: "not_found" };

  const result = await db
    .insert(profilePrograms)
    .values({ profileId, programId })
    .onConflictDoNothing()
    .returning({ profileId: profilePrograms.profileId });

  if (result.length === 0) return { error: "already_assigned" };
  return { ok: true };
};

export const removeMember = async (
  programId: string,
  profileId: string,
): Promise<{ ok: true } | { error: "not_found" }> => {
  if (!isValidUuid(programId) || !isValidUuid(profileId))
    return { error: "not_found" };

  const result = await db
    .delete(profilePrograms)
    .where(
      and(
        eq(profilePrograms.profileId, profileId),
        eq(profilePrograms.programId, programId),
      ),
    )
    .returning({ profileId: profilePrograms.profileId });

  if (result.length === 0) return { error: "not_found" };
  return { ok: true };
};
