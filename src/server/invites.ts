import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "./db";
import { invites } from "./schema";

// Alphabet: 23 uppercase letters (no I, O — visually confusable with 1/0)
// plus 8 digits (no 0, 1 — same reason). 31 chars.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;
// 31^10 ≈ 8.2e14 — sparse enough that collisions are vanishingly rare;
// the unique constraint is the real safety net.

const MAX_ACTIVE_INVITES_PER_USER = 10;
const INVITE_LIFETIME_DAYS = 30;
const MIN_NOTE_LENGTH = 10;

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

const generateInviteCode = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let out = "";
  for (const b of bytes) {
    out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return out;
};

const deriveStatus = (row: {
  redeemedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): InviteStatus => {
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

export const countActiveInvitesForCreator = async (
  createdBy: string,
): Promise<number> => {
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
  | { code: string; note: string; expiresAt: Date }
  | { error: "too_many_active"; limit: number };

export const createInvite = async (params: {
  createdBy: string;
  note: string;
}): Promise<CreateInviteResult> => {
  const active = await countActiveInvitesForCreator(params.createdBy);
  if (active >= MAX_ACTIVE_INVITES_PER_USER) {
    return { error: "too_many_active", limit: MAX_ACTIVE_INVITES_PER_USER };
  }

  // Retry loop guards against the astronomically-unlikely collision.
  // Three attempts is more than enough — collision probability at 10
  // chars over a 31-char alphabet is negligible even with millions of
  // rows.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateInviteCode();
    try {
      const [row] = await db
        .insert(invites)
        .values({
          code,
          createdBy: params.createdBy,
          note: params.note,
          expiresAt: sql`now() + interval '${sql.raw(String(INVITE_LIFETIME_DAYS))} days'`,
        })
        .returning({
          code: invites.code,
          note: invites.note,
          expiresAt: invites.expiresAt,
        });
      return row;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("invites_code_unique") && !msg.includes("duplicate")) {
        throw err;
      }
    }
  }
  throw new Error("createInvite: exhausted code-generation retries");
};

export const getInvitesForCreator = async (
  createdBy: string,
): Promise<InviteForCreator[]> => {
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

export type RevokeInviteResult =
  | { ok: true }
  | { error: "not_found" | "forbidden" | "already_redeemed" };

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

  await db
    .update(invites)
    .set({ revokedAt: sql`now()` })
    .where(eq(invites.code, params.code));
  return { ok: true };
};

export type RedeemInviteResult =
  | { ok: true; inviterId: string | null }
  | { error: "invalid" };

// Atomic redemption. Returns the inviter id so the caller can stamp
// referredBy on the new profile row. A single UPDATE...WHERE guarded
// by the unredeemed/unrevoked/unexpired predicates plus Postgres row
// locking means concurrent callers see exactly one success — no need
// for an explicit transaction here.
export const redeemInvite = async (params: {
  code: string;
  userId: string;
}): Promise<RedeemInviteResult> => {
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

export const checkInvite = async (
  code: string,
): Promise<CheckInviteResult> => {
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

