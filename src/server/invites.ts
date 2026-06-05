import { randomInt } from "node:crypto";
import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { MIN_NOTE_LENGTH } from "@/lib/invite-limits";
import { isRelationValue, type RelationValue } from "@/lib/relation-value";

import { db } from "./db";
import { validateInviteHints } from "./relations";
import { invites } from "./schema";

// Alphabet: 24 uppercase letters (no I, O — visually confusable with
// 1/0) plus 8 digits (no 0, 1 — same reason). 32 chars.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;
// 32^10 ≈ 1.1e15 — sparse enough that collisions are vanishingly rare;
// the unique constraint is the real safety net.

const MAX_ACTIVE_INVITES_PER_USER = 50;
const INVITE_LIFETIME_DAYS = 30;

export type InviteStatus = "active" | "redeemed" | "revoked" | "expired";

export type InviteForCreator = {
  code: string;
  note: string;
  createdAt: Date;
  expiresAt: Date;
  redeemedAt: Date | null;
  revokedAt: Date | null;
  status: InviteStatus;
};

// randomInt does uniform bounded sampling (rejection sampling
// internally), so indexing the alphabet with its result is unbiased
// for any alphabet size — no hand-rolled modulo or scaling on the raw
// random bytes, which is what CodeQL flags as a biasing operation.
const generateInviteCode = (): string => {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
};

const deriveStatus = (row: { redeemedAt: Date | null; revokedAt: Date | null; expiresAt: Date }): InviteStatus => {
  if (row.redeemedAt) return "redeemed";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= Date.now()) return "expired";
  return "active";
};

export const validateNote = (note: unknown): string | { error: string } => {
  if (typeof note !== "string") return { error: "note must be a string" };
  const trimmed = note.trim();
  if (trimmed.length < MIN_NOTE_LENGTH) {
    return { error: `note must be at least ${MIN_NOTE_LENGTH} characters` };
  }
  return trimmed;
};

export const countActiveInvitesForCreator = async (createdBy: string): Promise<number> => {
  const [row] = await db
    .select({ c: count() })
    .from(invites)
    .where(
      and(
        eq(invites.createdBy, createdBy),
        isNull(invites.redeemedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, sql`now()`),
      ),
    );
  return row?.c ?? 0;
};

export type CreateInviteResult =
  | { code: string; note: string; expiresAt: Date; relationValue: RelationValue | null; hintCount: number }
  | { error: "too_many_active"; limit: number }
  | { error: "invalid_relation_value" }
  | {
      error: "invalid_hints";
      reason: "not_an_array" | "non_uuid" | "self" | "duplicate" | "too_many" | "not_a_member";
    };

export const createInvite = async (params: {
  createdBy: string;
  note: string;
  relationValue?: RelationValue | null;
  hints?: string[];
}): Promise<CreateInviteResult> => {
  const relationValue = params.relationValue ?? null;
  if (relationValue !== null && !isRelationValue(relationValue)) {
    return { error: "invalid_relation_value" };
  }

  // Validate hints up front so we don't burn an invite-code slot on a
  // payload that's about to be rejected.
  const hintCheck = await validateInviteHints({ hints: params.hints, inviterId: params.createdBy });
  if ("error" in hintCheck) {
    return { error: "invalid_hints", reason: hintCheck.reason };
  }

  const active = await countActiveInvitesForCreator(params.createdBy);
  if (active >= MAX_ACTIVE_INVITES_PER_USER) {
    return { error: "too_many_active", limit: MAX_ACTIVE_INVITES_PER_USER };
  }

  // Retry loop guards against the astronomically-unlikely collision.
  // Three attempts is more than enough — collision probability at 10
  // chars over a 31-char alphabet is negligible even with millions of
  // rows. A code collision fails the whole statement, so no orphan
  // invite_hints rows survive.
  //
  // The invite and its hint rows are written in a single statement (a
  // writable CTE), not a db.transaction: a multi-statement transaction
  // over the Supabase transaction pooler can be silently discarded.
  // See docs/strategy-db-transactions.md.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateInviteCode();
    try {
      const [row] = (await db.execute(sql`
        WITH new_invite AS (
          INSERT INTO invites (code, created_by, note, expires_at, creator_value)
          VALUES (
            ${code},
            ${params.createdBy},
            ${params.note},
            now() + interval '${sql.raw(String(INVITE_LIFETIME_DAYS))} days',
            ${relationValue}
          )
          RETURNING id, code, note, expires_at, creator_value
        ),
        inserted_hints AS (
          INSERT INTO invite_hints (invite_id, ratee_id)
          SELECT new_invite.id, h.ratee_id
          FROM new_invite, unnest(ARRAY[${sql.join(
            hintCheck.ids.map((id) => sql`${id}`),
            sql`, `,
          )}]::uuid[]) AS h(ratee_id)
          RETURNING 1
        )
        SELECT code, note, expires_at AS "expiresAt", creator_value AS "relationValue"
        FROM new_invite
      `)) as unknown as {
        code: string;
        note: string;
        expiresAt: string;
        relationValue: number | null;
      }[];
      return {
        code: row.code,
        note: row.note,
        // Raw db.execute returns the timestamptz as a string; the typed
        // query builder would have mapped it to Date, raw SQL does not.
        expiresAt: new Date(row.expiresAt),
        relationValue: row.relationValue as RelationValue | null,
        hintCount: hintCheck.ids.length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("invites_code_unique") && !msg.includes("duplicate")) {
        throw err;
      }
    }
  }
  throw new Error("createInvite: exhausted code-generation retries");
};

export const getInvitesForCreator = async (createdBy: string): Promise<InviteForCreator[]> => {
  const rows = await db
    .select({
      code: invites.code,
      note: invites.note,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
      redeemedAt: invites.redeemedAt,
      revokedAt: invites.revokedAt,
    })
    .from(invites)
    .where(eq(invites.createdBy, createdBy))
    .orderBy(desc(invites.createdAt));

  return rows.map((r) => ({ ...r, status: deriveStatus(r) }));
};

export type RevokeInviteResult = { ok: true } | { error: "not_found" | "forbidden" | "already_redeemed" };

export const revokeInvite = async (params: {
  code: string;
  userId: string;
  isAdmin: boolean;
}): Promise<RevokeInviteResult> => {
  const [row] = await db
    .select({
      createdBy: invites.createdBy,
      redeemedAt: invites.redeemedAt,
      revokedAt: invites.revokedAt,
    })
    .from(invites)
    .where(eq(invites.code, params.code));

  if (!row) return { error: "not_found" };
  if (!params.isAdmin && row.createdBy !== params.userId) {
    return { error: "forbidden" };
  }
  if (row.redeemedAt) return { error: "already_redeemed" };
  if (row.revokedAt) return { ok: true }; // Idempotent.

  await db.update(invites).set({ revokedAt: sql`now()` }).where(eq(invites.code, params.code));
  return { ok: true };
};

export type RedeemInviteResult = { ok: true; inviterId: string | null } | { error: "invalid" };

// Atomic redemption. Returns the inviter id so the caller can stamp
// referredBy on the new profile row. A single UPDATE...WHERE guarded
// by the unredeemed/unrevoked/unexpired predicates plus Postgres row
// locking means concurrent callers see exactly one success — no need
// for an explicit transaction here.
export const redeemInvite = async (params: { code: string; userId: string }): Promise<RedeemInviteResult> => {
  const rows = await db
    .update(invites)
    .set({ redeemedBy: params.userId, redeemedAt: sql`now()` })
    .where(
      and(
        eq(invites.code, params.code),
        isNull(invites.redeemedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, sql`now()`),
      ),
    )
    .returning({ inviterId: invites.createdBy });

  if (rows.length === 0) return { error: "invalid" };
  return { ok: true, inviterId: rows[0].inviterId };
};

export type CheckInviteResult =
  | { valid: true; note: string }
  | { valid: false; reason: "not_found" | "revoked" | "expired" | "redeemed" };

export const checkInvite = async (code: string): Promise<CheckInviteResult> => {
  const [row] = await db
    .select({
      note: invites.note,
      redeemedAt: invites.redeemedAt,
      revokedAt: invites.revokedAt,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .where(eq(invites.code, code));

  if (!row) return { valid: false, reason: "not_found" };
  if (row.redeemedAt) return { valid: false, reason: "redeemed" };
  if (row.revokedAt) return { valid: false, reason: "revoked" };
  if (row.expiresAt.getTime() <= Date.now()) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true, note: row.note };
};
