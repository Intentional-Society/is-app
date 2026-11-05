import { and, eq, sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";

import { isProgramFeatureKey, PROGRAM_FEATURES, type ProgramFeatureDefinition } from "@/lib/program-features";

import { type ApiVariables, isUuid } from "./auth-middleware";
import { db } from "./db";
import { profilePrograms, programFeatures, programs } from "./schema";

// Program features (docs/design-programs.md). The registry of what exists is
// code (src/lib/program-features.ts); this module owns the data half, which
// programs have which features, and the one access check every feature page
// and API route goes through, so the UI and the API can't disagree.

export type FeatureAccess = { error: "not_found" } | { participant: boolean };

// Resolves the caller's standing for one feature of one program. "not_found"
// covers every reason the feature isn't there: an unknown key, a missing or
// archived program, or a feature that isn't attached. Otherwise the feature
// exists, and `participant` says whether the caller is an active participant.
// What a non-participant may do is the feature's call: most features are
// participant-only, the message box lets anyone read.
export const getFeatureAccess = async (
  userId: string,
  programId: string,
  featureKey: string,
): Promise<FeatureAccess> => {
  if (!isProgramFeatureKey(featureKey) || !isUuid(programId)) return { error: "not_found" };

  const [row] = await db
    .select({
      archivedAt: programs.archivedAt,
      attached: sql<boolean>`EXISTS (
        SELECT 1 FROM ${programFeatures}
        WHERE ${programFeatures.programId} = ${programs.id}
          AND ${programFeatures.featureKey} = ${featureKey}
      )`,
      participant: sql<boolean>`EXISTS (
        SELECT 1 FROM ${profilePrograms}
        WHERE ${profilePrograms.programId} = ${programs.id}
          AND ${profilePrograms.profileId} = ${userId}
          AND ${profilePrograms.leftAt} IS NULL
      )`,
    })
    .from(programs)
    .where(eq(programs.id, programId));

  if (!row || row.archivedAt !== null || !row.attached) return { error: "not_found" };
  return { participant: row.participant };
};

export type FeatureVariables = ApiVariables & { featureParticipant: boolean };

// Shared middleware for feature routes mounted at /programs/:id/<feature-key>.
// A feature that isn't attached, or an archived program, answers 404
// not_found (matching the existing archived handling). On success the
// caller's participant flag is on the context.
export const requireProgramFeature =
  (featureKey: string): MiddlewareHandler<{ Variables: FeatureVariables }> =>
  async (c, next) => {
    const access = await getFeatureAccess(c.get("user").id, c.req.param("id") ?? "", featureKey);
    if ("error" in access) return c.json({ error: "not_found" as const }, 404);
    c.set("featureParticipant", access.participant);
    return next();
  };

// Keys of the features attached to a program that the code still knows
// about. Retired keys (a row whose key left the registry) are ignored.
export const listAttachedFeatureKeys = async (programId: string): Promise<string[]> => {
  const rows = await db
    .select({ featureKey: programFeatures.featureKey })
    .from(programFeatures)
    .where(eq(programFeatures.programId, programId));
  return rows.map((r) => r.featureKey).filter(isProgramFeatureKey);
};

export type AdminProgramFeature = ProgramFeatureDefinition & { attached: boolean };

// Every registry feature with whether it is attached to this program, for
// the toggles on /admin/programs/[id].
export const listFeaturesForAdmin = async (
  programId: string,
): Promise<{ features: AdminProgramFeature[] } | { error: "not_found" }> => {
  if (!isUuid(programId)) return { error: "not_found" };
  const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "not_found" };

  const attached = new Set(await listAttachedFeatureKeys(programId));
  return { features: PROGRAM_FEATURES.map((f) => ({ ...f, attached: attached.has(f.key) })) };
};

// Idempotent attach/detach. Detaching leaves the feature's data in place.
export const setFeatureAttached = async (
  programId: string,
  featureKey: string,
  attached: boolean,
): Promise<{ ok: true } | { error: "not_found" | "unknown_feature" }> => {
  if (!isProgramFeatureKey(featureKey)) return { error: "unknown_feature" };
  if (!isUuid(programId)) return { error: "not_found" };

  const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "not_found" };

  if (attached) {
    await db.insert(programFeatures).values({ programId, featureKey }).onConflictDoNothing();
  } else {
    await db
      .delete(programFeatures)
      .where(and(eq(programFeatures.programId, programId), eq(programFeatures.featureKey, featureKey)));
  }
  return { ok: true };
};
