import * as Sentry from "@sentry/nextjs";
import { and, asc, eq, inArray, ne, notExists, sql } from "drizzle-orm";

import { isUuid } from "./auth-middleware";
import { attachAvatarUrls } from "./avatars";
import { db } from "./db";
import { profilePrograms, profiles, programs } from "./schema";

// Slugs of programs every new member is enrolled in automatically on
// first sign-in. The welcome flow's "We added one for you" copy on
// /welcome/programs points at this list. Mirrors the same constant in
// scripts/import-members-csv.ts — keep them in sync.
const AUTO_SUBSCRIBE_SLUGS = ["weekly-web-updates"] as const;

// Best-effort: subscribe a freshly-created member to the auto-subscribe
// programs. A missing slug is logged to Sentry and skipped rather than
// failing — sign-in shouldn't break over a misconfigured program list,
// and operators can patch the database after the fact. Idempotent via
// onConflictDoNothing, but callers should still gate on "is this a new
// profile" so re-subscribing won't undo a member's opt-out.
export const autoSubscribeNewMember = async (userId: string): Promise<void> => {
  const rows = await db
    .select({ id: programs.id, slug: programs.slug })
    .from(programs)
    .where(inArray(programs.slug, AUTO_SUBSCRIBE_SLUGS as unknown as string[]));

  const found = new Set(rows.map((r) => r.slug));
  for (const slug of AUTO_SUBSCRIBE_SLUGS) {
    if (!found.has(slug)) {
      Sentry.captureException(
        new Error(`autoSubscribeNewMember: program slug "${slug}" not found in database`),
      );
    }
  }

  if (rows.length === 0) return;

  await db
    .insert(profilePrograms)
    .values(rows.map((r) => ({ profileId: userId, programId: r.id })))
    .onConflictDoNothing();
};

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
export const listPrograms = async (userId: string): Promise<ProgramWithMembership[]> => {
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
  const [existing] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, userId));

  if (!existing) {
    await db.insert(profiles).values({ id: userId }).onConflictDoNothing();
  }
};

export const joinProgram = async (
  userId: string,
  programId: string,
): Promise<{ ok: true } | { error: "not_found" | "already_joined" }> => {
  if (!isUuid(programId)) return { error: "not_found" };

  // Verify program exists
  const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, programId));

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
  if (!isUuid(programId)) return { error: "not_found" };

  const result = await db
    .delete(profilePrograms)
    .where(and(eq(profilePrograms.profileId, userId), eq(profilePrograms.programId, programId)))
    .returning({ profileId: profilePrograms.profileId });

  if (result.length === 0) return { error: "not_found" };

  return { ok: true };
};

// --- Admin program administration (issue #139) ---------------------
//
// The functions above are member-facing: browse, join, leave. Below is
// the admin surface — create/edit programs, manage who is enrolled, and
// delete empty programs. Programs with participants are kept; a richer
// "retire" flow for live programs comes later.

export type AdminProgram = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
};

export type ProgramParticipant = {
  id: string;
  slug: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  assignedAt: string;
};

export type ProgramDetail = AdminProgram & { participants: ProgramParticipant[] };

const MAX_PROGRAM_NAME = 120;
const MAX_PROGRAM_SLUG = 80;
const MAX_PROGRAM_DESCRIPTION = 2000;

// Slugs are chosen by the admin, independently of the display name.
// Enforce a URL-safe shape: lowercase alphanumerics in hyphen-separated
// groups, with no leading, trailing, or doubled hyphens.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_RULE = "slug must be lowercase letters, numbers, and hyphens";

const trimmedString = (value: unknown): string | null =>
  typeof value === "string" ? value.trim() : null;

// Validates an admin-supplied slug. Returns the slug or an error string.
const validateSlug = (slug: string): { slug: string } | { error: string } => {
  if (slug.length > MAX_PROGRAM_SLUG) return { error: "slug is too long" };
  if (!SLUG_PATTERN.test(slug)) return { error: SLUG_RULE };
  return { slug };
};

// Parses a create-program body. Name and slug are both required and
// chosen independently; description is optional, null when blank.
export const parseProgramCreate = (
  body: unknown,
): { name: string; slug: string; description: string | null } | { error: string } => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const obj = body as Record<string, unknown>;
  const name = trimmedString(obj.name);
  if (!name) return { error: "name is required" };
  if (name.length > MAX_PROGRAM_NAME) return { error: "name is too long" };

  const slug = trimmedString(obj.slug);
  if (!slug) return { error: "slug is required" };
  const slugCheck = validateSlug(slug);
  if ("error" in slugCheck) return slugCheck;

  const description = trimmedString(obj.description);
  if (description && description.length > MAX_PROGRAM_DESCRIPTION) {
    return { error: "description is too long" };
  }
  return { name, slug, description: description || null };
};

// Parses an edit-program body. Every field is optional — only the keys
// present are updated — but a present `name` or `slug` must be valid.
export const parseProgramUpdate = (
  body: unknown,
): { name?: string; slug?: string; description?: string | null } | { error: string } => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const obj = body as Record<string, unknown>;
  const result: { name?: string; slug?: string; description?: string | null } = {};

  if ("name" in obj) {
    const name = trimmedString(obj.name);
    if (!name) return { error: "name must be a non-empty string" };
    if (name.length > MAX_PROGRAM_NAME) return { error: "name is too long" };
    result.name = name;
  }
  if ("slug" in obj) {
    const slug = trimmedString(obj.slug);
    if (!slug) return { error: "slug must be a non-empty string" };
    const slugCheck = validateSlug(slug);
    if ("error" in slugCheck) return slugCheck;
    result.slug = slug;
  }
  if ("description" in obj) {
    const description = trimmedString(obj.description);
    if (description && description.length > MAX_PROGRAM_DESCRIPTION) {
      return { error: "description is too long" };
    }
    result.description = description || null;
  }
  return result;
};

// Every program with its member count. Unlike listPrograms this carries
// no per-user membership — admins manage programs, they don't join them.
export const listAllProgramsForAdmin = async (): Promise<AdminProgram[]> => {
  return db
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      description: programs.description,
      createdAt: sql<string>`to_json(${programs.createdAt}) #>> '{}'`,
      memberCount: sql<number>`(
        SELECT count(*)::int FROM ${profilePrograms}
        WHERE ${profilePrograms.programId} = ${programs.id}
      )`,
    })
    .from(programs)
    .orderBy(asc(programs.name));
};

export const createProgram = async (input: {
  name: string;
  slug: string;
  description: string | null;
}): Promise<{ program: AdminProgram } | { error: "slug_conflict" }> => {
  const [existing] = await db.select({ id: programs.id }).from(programs).where(eq(programs.slug, input.slug));
  if (existing) return { error: "slug_conflict" };

  const [row] = await db
    .insert(programs)
    .values({ slug: input.slug, name: input.name, description: input.description })
    .returning();

  return {
    program: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      memberCount: 0,
      createdAt: row.createdAt.toISOString(),
    },
  };
};

export const updateProgram = async (
  programId: string,
  input: { name?: string; slug?: string; description?: string | null },
): Promise<{ ok: true } | { error: "not_found" | "slug_conflict" }> => {
  if (!isUuid(programId)) return { error: "not_found" };

  const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "not_found" };

  const update: { name?: string; slug?: string; description?: string | null } = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.description !== undefined) update.description = input.description;
  if (input.slug !== undefined) {
    // Reject a slug a different program already holds; the row keeping
    // its own slug unchanged is fine.
    const [clash] = await db
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.slug, input.slug), ne(programs.id, programId)));
    if (clash) return { error: "slug_conflict" };
    update.slug = input.slug;
  }

  if (Object.keys(update).length > 0) {
    await db.update(programs).set(update).where(eq(programs.id, programId));
  }
  return { ok: true };
};

// A single program with its enrolled participants, for the admin
// drill-down. Participants reuse the avatar-URL signing that listMembers
// applies, so the UI renders the same avatars.
export const getProgramDetail = async (
  programId: string,
): Promise<{ program: ProgramDetail } | { error: "not_found" }> => {
  if (!isUuid(programId)) return { error: "not_found" };

  const [program] = await db
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      description: programs.description,
      createdAt: programs.createdAt,
    })
    .from(programs)
    .where(eq(programs.id, programId));
  if (!program) return { error: "not_found" };

  const rows = await db
    .select({
      id: profiles.id,
      slug: profiles.slug,
      displayName: profiles.displayName,
      avatarPath: profiles.avatarPath,
      assignedAt: profilePrograms.assignedAt,
    })
    .from(profilePrograms)
    .innerJoin(profiles, eq(profiles.id, profilePrograms.profileId))
    .where(eq(profilePrograms.programId, programId))
    .orderBy(asc(profiles.displayName));

  const withUrls = await attachAvatarUrls(rows);
  const participants: ProgramParticipant[] = withUrls.map((r) => ({
    id: r.id,
    slug: r.slug,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    assignedAt: r.assignedAt.toISOString(),
  }));

  return {
    program: {
      id: program.id,
      slug: program.slug,
      name: program.name,
      description: program.description,
      createdAt: program.createdAt.toISOString(),
      memberCount: participants.length,
      participants,
    },
  };
};

export const addParticipant = async (
  programId: string,
  profileId: string,
): Promise<
  { ok: true } | { error: "program_not_found" | "profile_not_found" | "already_member" }
> => {
  if (!isUuid(programId)) return { error: "program_not_found" };
  if (!isUuid(profileId)) return { error: "profile_not_found" };

  const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "program_not_found" };

  const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, profileId));
  if (!profile) return { error: "profile_not_found" };

  const result = await db
    .insert(profilePrograms)
    .values({ profileId, programId })
    .onConflictDoNothing()
    .returning({ profileId: profilePrograms.profileId });

  if (result.length === 0) return { error: "already_member" };
  return { ok: true };
};

// Deletes a program only while it has no participants — the guardrail
// for clearing out test data and mistakes without touching live ones.
// The "no participants" check rides on the DELETE as a NOT EXISTS
// subquery so it's atomic: a join landing between a separate check and
// the delete can't slip a participant past the FK cascade.
export const deleteProgram = async (
  programId: string,
): Promise<{ ok: true } | { error: "not_found" | "has_participants" }> => {
  if (!isUuid(programId)) return { error: "not_found" };

  const deleted = await db
    .delete(programs)
    .where(
      and(
        eq(programs.id, programId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(profilePrograms)
            .where(eq(profilePrograms.programId, programId)),
        ),
      ),
    )
    .returning({ id: programs.id });

  if (deleted.length > 0) return { ok: true };

  // Nothing deleted: the program is either gone or still has
  // participants. Re-read to tell 404 apart from 409 for the caller.
  const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, programId));
  return program ? { error: "has_participants" } : { error: "not_found" };
};

export const removeParticipant = async (
  programId: string,
  profileId: string,
): Promise<{ ok: true } | { error: "not_found" }> => {
  if (!isUuid(programId) || !isUuid(profileId)) return { error: "not_found" };

  const result = await db
    .delete(profilePrograms)
    .where(and(eq(profilePrograms.programId, programId), eq(profilePrograms.profileId, profileId)))
    .returning({ profileId: profilePrograms.profileId });

  if (result.length === 0) return { error: "not_found" };
  return { ok: true };
};
