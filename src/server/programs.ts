import { captureException as Sentry_captureException } from "@sentry/nextjs";
import { and, asc, desc, eq, inArray, isNull, ne, notExists, sql } from "drizzle-orm";

import { isUuid } from "./auth-middleware";
import { attachAvatarUrls } from "./avatars";
import { db } from "./db";
import { profilePrograms, profiles, programs } from "./schema";

// Slugs of programs every new member is enrolled in automatically on
// first sign-in. The welcome flow's "We added one for you" copy on
// /welcome/programs points at this list.
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
      Sentry_captureException(new Error(`autoSubscribeNewMember: program slug "${slug}" not found in database`));
    }
  }

  if (rows.length === 0) return;

  await db
    .insert(profilePrograms)
    .values(rows.map((r) => ({ profileId: userId, programId: r.id })))
    .onConflictDoNothing();
};

export type ProgramMemberAvatar = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type ProgramWithMembership = {
  id: string;
  slug: string;
  name: string;
  blurb: string | null;
  description: string | null;
  signupsOpen: boolean;
  memberCount: number;
  joined: boolean;
  joinedAt: string | null;
  memberAvatars: ProgramMemberAvatar[];
};

// Note: memberCount and joinedAt use correlated subqueries which is
// fine for a small number of programs. If the programs table grows
// significantly, refactor to LEFT JOIN + GROUP BY with a conditional
// aggregate for the current user's assigned_at.
//
// Archived programs are hidden — admins manage them via /admin/programs.
// signupsOpen is returned so the client can disable the join button on
// programs that are still listed but not currently accepting joins.
//
// "Member" means currently joined (left_at IS NULL). Left memberships
// stay in the table to preserve the original assigned_at as the stable
// first-joined date across rejoin cycles, but they don't count toward
// member counts or the viewer's joined flag.
export const listPrograms = async (userId: string): Promise<ProgramWithMembership[]> => {
  const rows = await db
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      blurb: programs.blurb,
      description: programs.description,
      signupsOpen: programs.signupsOpen,
      memberCount: sql<number>`(
        SELECT count(*)::int FROM ${profilePrograms}
        WHERE ${profilePrograms.programId} = ${programs.id}
          AND ${profilePrograms.leftAt} IS NULL
      )`,
      joinedAt: sql<string | null>`(
        SELECT to_json(${profilePrograms.assignedAt}) #>> '{}' FROM ${profilePrograms}
        WHERE ${profilePrograms.programId} = ${programs.id}
          AND ${profilePrograms.profileId} = ${userId}
          AND ${profilePrograms.leftAt} IS NULL
      )`,
    })
    .from(programs)
    .where(isNull(programs.archivedAt))
    .orderBy(programs.name);

  // Fetch up to 5 current members per program for the avatar facepile.
  const programIds = rows.map((r) => r.id);
  const avatarRows =
    programIds.length > 0
      ? await db
          .select({
            programId: profilePrograms.programId,
            id: profiles.id,
            displayName: profiles.displayName,
            avatarPath: profiles.avatarPath,
            assignedAt: profilePrograms.assignedAt,
          })
          .from(profilePrograms)
          .innerJoin(profiles, eq(profiles.id, profilePrograms.profileId))
          .where(and(inArray(profilePrograms.programId, programIds), isNull(profilePrograms.leftAt)))
          .orderBy(desc(profilePrograms.assignedAt))
      : [];

  const withAvatarUrls = await attachAvatarUrls(avatarRows);

  const avatarsByProgram = new Map<string, ProgramMemberAvatar[]>();
  for (const row of withAvatarUrls) {
    const existing = avatarsByProgram.get(row.programId) ?? [];
    if (existing.length < 5) {
      existing.push({ id: row.id, displayName: row.displayName, avatarUrl: row.avatarUrl });
      avatarsByProgram.set(row.programId, existing);
    }
  }

  return rows.map((r) => ({
    ...r,
    joined: r.joinedAt !== null,
    memberAvatars: avatarsByProgram.get(r.id) ?? [],
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

// --- Soft-delete primitives -----------------------------------------
//
// The four public functions (joinProgram, leaveProgram, addParticipant,
// removeParticipant) all differ in their gates and error taxonomy, but
// the actual mutation reduces to one of two state transitions. These
// helpers own the mutation; the public functions own the policy.

// First-insert or rejoin. Returns true if the row is newly current — an
// INSERT (first-ever join) or an UPDATE clearing leftAt (rejoin) — and
// false if a current row already existed (no-op). assignedAt is set on
// the first insert and never touched on rejoin, so it survives any
// leave/rejoin cycle as the stable first-joined date. The conditional
// DO UPDATE setWhere is what gives us the "already a member" signal:
// when the existing row is already current, Postgres treats the
// conflict as DO NOTHING and the RETURNING set comes back empty.
const setMembershipActive = async (profileId: string, programId: string): Promise<boolean> => {
  const result = await db
    .insert(profilePrograms)
    .values({ profileId, programId })
    .onConflictDoUpdate({
      target: [profilePrograms.profileId, profilePrograms.programId],
      set: { leftAt: null },
      setWhere: sql`${profilePrograms.leftAt} IS NOT NULL`,
    })
    .returning({ profileId: profilePrograms.profileId });
  return result.length > 0;
};

// Soft-delete the current membership. Returns true if a current row was
// ended, false if there was nothing to end (already left, or the
// (profile, program) pair never had a row). The leftAt IS NULL guard
// makes this idempotent past the first call — callers can treat the
// false return as "not_found" without a separate read.
const setMembershipEnded = async (profileId: string, programId: string): Promise<boolean> => {
  const result = await db
    .update(profilePrograms)
    .set({ leftAt: sql`now()` })
    .where(
      and(
        eq(profilePrograms.profileId, profileId),
        eq(profilePrograms.programId, programId),
        isNull(profilePrograms.leftAt),
      ),
    )
    .returning({ profileId: profilePrograms.profileId });
  return result.length > 0;
};

export const joinProgram = async (
  userId: string,
  programId: string,
): Promise<{ ok: true } | { error: "not_found" | "already_joined" | "signups_closed" }> => {
  if (!isUuid(programId)) return { error: "not_found" };

  // Read archive + signupsOpen alongside the existence check. Archived
  // programs are surfaced as "not_found" — members shouldn't see them
  // in their listing, so a join attempt with the id is treated like an
  // attempt at any other unknown program.
  const [program] = await db
    .select({
      id: programs.id,
      archivedAt: programs.archivedAt,
      signupsOpen: programs.signupsOpen,
    })
    .from(programs)
    .where(eq(programs.id, programId));

  if (!program || program.archivedAt !== null) return { error: "not_found" };
  if (!program.signupsOpen) return { error: "signups_closed" };

  // Self-heal: ensure profile row exists before FK insert
  await ensureProfile(userId);

  return (await setMembershipActive(userId, programId)) ? { ok: true } : { error: "already_joined" };
};

export const leaveProgram = async (
  userId: string,
  programId: string,
): Promise<{ ok: true } | { error: "not_found" }> => {
  if (!isUuid(programId)) return { error: "not_found" };

  return (await setMembershipEnded(userId, programId)) ? { ok: true } : { error: "not_found" };
};

// --- Per-program detail (member-facing) ------------------------------
//
// The detail page at /programs/[slug] shows a single program's members
// alongside the description, with a join/leave button for the viewer.
// Archived programs return not_found here — the listing already hides
// them, so a deep link to an archived slug should look like any other
// missing page.

export type ProgramMember = {
  id: string;
  slug: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  joinedAt: string;
};

export type ProgramDetailForMember = {
  id: string;
  slug: string;
  name: string;
  blurb: string | null;
  description: string | null;
  signupsOpen: boolean;
  memberCount: number;
  joined: boolean;
  joinedAt: string | null;
  members: ProgramMember[];
};

export const getProgramBySlug = async (
  slug: string,
  viewerId: string,
): Promise<{ program: ProgramDetailForMember } | { error: "not_found" }> => {
  const [program] = await db
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      blurb: programs.blurb,
      description: programs.description,
      signupsOpen: programs.signupsOpen,
      archivedAt: programs.archivedAt,
    })
    .from(programs)
    .where(eq(programs.slug, slug));

  if (!program || program.archivedAt !== null) return { error: "not_found" };

  // Current participants only. Left rows live on for the stable
  // assignedAt but aren't part of the public roster.
  const memberRows = await db
    .select({
      id: profiles.id,
      slug: profiles.slug,
      displayName: profiles.displayName,
      avatarPath: profiles.avatarPath,
      assignedAt: profilePrograms.assignedAt,
    })
    .from(profilePrograms)
    .innerJoin(profiles, eq(profiles.id, profilePrograms.profileId))
    .where(and(eq(profilePrograms.programId, program.id), isNull(profilePrograms.leftAt)))
    .orderBy(asc(profiles.displayName));

  const withUrls = await attachAvatarUrls(memberRows);
  const members: ProgramMember[] = withUrls.map((m) => ({
    id: m.id,
    slug: m.slug,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl,
    joinedAt: m.assignedAt.toISOString(),
  }));

  const viewer = members.find((m) => m.id === viewerId) ?? null;

  return {
    program: {
      id: program.id,
      slug: program.slug,
      name: program.name,
      blurb: program.blurb,
      description: program.description,
      signupsOpen: program.signupsOpen,
      memberCount: members.length,
      joined: viewer !== null,
      joinedAt: viewer?.joinedAt ?? null,
      members,
    },
  };
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
  blurb: string | null;
  description: string | null;
  archivedAt: string | null;
  signupsOpen: boolean;
  buttondownTag: string | null;
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
const MAX_PROGRAM_BLURB = 200;
const MAX_PROGRAM_DESCRIPTION = 2000;
// Buttondown tag names are short by convention; the cap is well above
// anything Buttondown surfaces in its UI and keeps the column index-friendly.
const MAX_BUTTONDOWN_TAG = 100;

// Slugs are chosen by the admin, independently of the display name.
// Enforce a URL-safe shape: lowercase alphanumerics in hyphen-separated
// groups, with no leading, trailing, or doubled hyphens.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_RULE = "slug must be lowercase letters, numbers, and hyphens";

const trimmedString = (value: unknown): string | null => (typeof value === "string" ? value.trim() : null);

// Validates an admin-supplied slug. Returns the slug or an error string.
const validateSlug = (slug: string): { slug: string } | { error: string } => {
  if (slug.length > MAX_PROGRAM_SLUG) return { error: "slug is too long" };
  if (!SLUG_PATTERN.test(slug)) return { error: SLUG_RULE };
  return { slug };
};

// Parses a create-program body. Name and slug are both required and
// chosen independently; description is optional, null when blank.
// buttondownTag is also optional; blank is normalized to null.
export const parseProgramCreate = (
  body: unknown,
):
  | { name: string; slug: string; blurb: string | null; description: string | null; buttondownTag: string | null }
  | { error: string } => {
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

  const blurb = trimmedString(obj.blurb);
  if (blurb && blurb.length > MAX_PROGRAM_BLURB) {
    return { error: "blurb is too long" };
  }

  const description = trimmedString(obj.description);
  if (description && description.length > MAX_PROGRAM_DESCRIPTION) {
    return { error: "description is too long" };
  }

  const buttondownTag = trimmedString(obj.buttondownTag);
  if (buttondownTag && buttondownTag.length > MAX_BUTTONDOWN_TAG) {
    return { error: "buttondownTag is too long" };
  }
  return {
    name,
    slug,
    blurb: blurb || null,
    description: description || null,
    buttondownTag: buttondownTag || null,
  };
};

// Parses an edit-program body. Every field is optional — only the keys
// present are updated — but a present `name` or `slug` must be valid.
// `archived` is a boolean toggle: true stamps archived_at = now(), false
// clears it. `signupsOpen` flips directly. Both are passed through as
// their resolved column values so updateProgram doesn't have to know.
export type ProgramUpdate = {
  name?: string;
  slug?: string;
  blurb?: string | null;
  description?: string | null;
  archived?: boolean;
  signupsOpen?: boolean;
  // null = opt this program out of Buttondown sync. Non-empty string =
  // the exact Buttondown tag to manage. Empty/blank from the client is
  // normalized to null in the parser.
  buttondownTag?: string | null;
};

export const parseProgramUpdate = (body: unknown): ProgramUpdate | { error: string } => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const obj = body as Record<string, unknown>;
  const result: ProgramUpdate = {};

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
  if ("blurb" in obj) {
    const blurb = trimmedString(obj.blurb);
    if (blurb && blurb.length > MAX_PROGRAM_BLURB) {
      return { error: "blurb is too long" };
    }
    result.blurb = blurb || null;
  }
  if ("description" in obj) {
    const description = trimmedString(obj.description);
    if (description && description.length > MAX_PROGRAM_DESCRIPTION) {
      return { error: "description is too long" };
    }
    result.description = description || null;
  }
  if ("archived" in obj) {
    if (typeof obj.archived !== "boolean") return { error: "archived must be a boolean" };
    result.archived = obj.archived;
  }
  if ("signupsOpen" in obj) {
    if (typeof obj.signupsOpen !== "boolean") return { error: "signupsOpen must be a boolean" };
    result.signupsOpen = obj.signupsOpen;
  }
  if ("buttondownTag" in obj) {
    // Accept null or a trimmable string; everything else is a 400.
    // Blank / whitespace-only normalizes to null (the "unset" state).
    if (obj.buttondownTag === null) {
      result.buttondownTag = null;
    } else {
      const tag = trimmedString(obj.buttondownTag);
      if (tag === null) return { error: "buttondownTag must be a string or null" };
      if (tag.length > MAX_BUTTONDOWN_TAG) return { error: "buttondownTag is too long" };
      result.buttondownTag = tag || null;
    }
  }
  return result;
};

// Every program with its member count. Unlike listPrograms this carries
// no per-user membership — admins manage programs, they don't join them.
// Archived programs are included here so admins can re-open them; the
// member-facing listPrograms hides them. memberCount excludes left
// rows so admins see the same "currently in" number members do.
export const listAllProgramsForAdmin = async (): Promise<AdminProgram[]> => {
  return db
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      blurb: programs.blurb,
      description: programs.description,
      archivedAt: sql<string | null>`to_json(${programs.archivedAt}) #>> '{}'`,
      signupsOpen: programs.signupsOpen,
      buttondownTag: programs.buttondownTag,
      createdAt: sql<string>`to_json(${programs.createdAt}) #>> '{}'`,
      memberCount: sql<number>`(
        SELECT count(*)::int FROM ${profilePrograms}
        WHERE ${profilePrograms.programId} = ${programs.id}
          AND ${profilePrograms.leftAt} IS NULL
      )`,
    })
    .from(programs)
    .orderBy(asc(programs.name));
};

export const createProgram = async (input: {
  name: string;
  slug: string;
  blurb: string | null;
  description: string | null;
  buttondownTag: string | null;
}): Promise<{ program: AdminProgram } | { error: "slug_conflict" }> => {
  const [existing] = await db.select({ id: programs.id }).from(programs).where(eq(programs.slug, input.slug));
  if (existing) return { error: "slug_conflict" };

  const [row] = await db
    .insert(programs)
    .values({
      slug: input.slug,
      name: input.name,
      blurb: input.blurb,
      description: input.description,
      buttondownTag: input.buttondownTag,
    })
    .returning();

  return {
    program: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      blurb: row.blurb,
      description: row.description,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      signupsOpen: row.signupsOpen,
      buttondownTag: row.buttondownTag,
      memberCount: 0,
      createdAt: row.createdAt.toISOString(),
    },
  };
};

export const updateProgram = async (
  programId: string,
  input: ProgramUpdate,
): Promise<{ ok: true } | { error: "not_found" | "slug_conflict" }> => {
  if (!isUuid(programId)) return { error: "not_found" };

  const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "not_found" };

  // Drizzle's set() accepts an SQL expression for archived_at when we
  // want now()/null, so split the type out from the validated input.
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.blurb !== undefined) update.blurb = input.blurb;
  if (input.description !== undefined) update.description = input.description;
  if (input.archived !== undefined) {
    update.archivedAt = input.archived ? sql`now()` : null;
  }
  if (input.signupsOpen !== undefined) update.signupsOpen = input.signupsOpen;
  if (input.buttondownTag !== undefined) update.buttondownTag = input.buttondownTag;
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
      blurb: programs.blurb,
      description: programs.description,
      archivedAt: programs.archivedAt,
      signupsOpen: programs.signupsOpen,
      buttondownTag: programs.buttondownTag,
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
    .where(and(eq(profilePrograms.programId, programId), isNull(profilePrograms.leftAt)))
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
      blurb: program.blurb,
      description: program.description,
      archivedAt: program.archivedAt ? program.archivedAt.toISOString() : null,
      signupsOpen: program.signupsOpen,
      buttondownTag: program.buttondownTag,
      createdAt: program.createdAt.toISOString(),
      memberCount: participants.length,
      participants,
    },
  };
};

export const addParticipant = async (
  programId: string,
  profileId: string,
): Promise<{ ok: true } | { error: "program_not_found" | "profile_not_found" | "already_member" }> => {
  if (!isUuid(programId)) return { error: "program_not_found" };
  if (!isUuid(profileId)) return { error: "profile_not_found" };

  const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "program_not_found" };

  const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, profileId));
  if (!profile) return { error: "profile_not_found" };

  // The admin path ignores signupsOpen — admins can add a participant
  // even to a program with closed signups.
  return (await setMembershipActive(profileId, programId)) ? { ok: true } : { error: "already_member" };
};

// Deletes a program only while it has no current participants — the
// guardrail for clearing out test data and mistakes without touching
// live ones. The "no participants" check rides on the DELETE as a NOT
// EXISTS subquery so it's atomic: a join landing between a separate
// check and the delete can't slip a participant past the FK cascade.
// Past members (leftAt IS NOT NULL) don't block the delete; the FK
// cascade still nukes their history rows, which is fine — the program
// itself is going away.
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
            .where(and(eq(profilePrograms.programId, programId), isNull(profilePrograms.leftAt))),
        ),
      ),
    )
    .returning({ id: programs.id });

  if (deleted.length > 0) return { ok: true };

  // Nothing deleted: the program is either gone or still has current
  // participants. Re-read to tell 404 apart from 409 for the caller.
  const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, programId));
  return program ? { error: "has_participants" } : { error: "not_found" };
};

export const removeParticipant = async (
  programId: string,
  profileId: string,
): Promise<{ ok: true } | { error: "not_found" }> => {
  if (!isUuid(programId) || !isUuid(profileId)) return { error: "not_found" };

  return (await setMembershipEnded(profileId, programId)) ? { ok: true } : { error: "not_found" };
};
