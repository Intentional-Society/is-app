import * as Sentry from "@sentry/nextjs";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/server/db";
import { autoSubscribeNewMember } from "@/server/programs";
import { upsertProfile } from "@/server/profiles";
import { materializeInviteRelations } from "@/server/relations";
import { invites, profiles } from "@/server/schema";

// Best-effort wrapper around the auto-subscribe step. Failures are
// captured to Sentry and swallowed so a hiccup here never breaks
// sign-in — the member can join later from /programs.
const tryAutoSubscribe = async (userId: string): Promise<void> => {
  try {
    await autoSubscribeNewMember(userId);
  } catch (err) {
    Sentry.captureException(err);
  }
};

// Pull the `invite` query param out of the `next` URL the email
// carried through from `emailRedirectTo`. The value may be a full URL
// (signup form sends `${origin}/?invite=XYZ`) or a path-only string;
// `new URL(next, request.url)` handles both.
const extractInvite = (next: string | null, base: string): string | null => {
  if (!next) return null;
  try {
    return new URL(next, base).searchParams.get("invite");
  } catch {
    return null;
  }
};

// The two `type` values our templates emit. Supabase's EmailOtpType is
// wider ("signup" | "invite" | "magiclink" | "email_change" | …) but
// we don't route any of those, so we narrow at the boundary instead of
// trusting the query string with an `as EmailOtpType` cast.
const ALLOWED_TYPES = ["email", "recovery"] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

const isAllowedType = (v: string | null): v is AllowedType =>
  v !== null && (ALLOWED_TYPES as readonly string[]).includes(v);

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const next = request.nextUrl.searchParams.get("next");

  if (!tokenHash || !isAllowedType(type)) {
    return NextResponse.redirect(new URL("/signin?error=missing_token", request.url));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/signin?error=verify_failed", request.url));
  }

  // Password reset — skip profile upsert, redirect to set-password page.
  if (type === "recovery") {
    return NextResponse.redirect(new URL("/auth/reset-password", request.url));
  }

  const invite = extractInvite(next, request.url);

  // Ordinary sign-in — Phase 1 upsert, referredBy stays null.
  if (!invite) {
    let result: { created: boolean };
    try {
      result = await upsertProfile(data.user);
    } catch {
      return NextResponse.redirect(new URL("/signin?error=profile_error", request.url));
    }
    if (result.created) {
      await tryAutoSubscribe(data.user.id);
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Invited sign-in. Profile insert + invite redemption must land
  // atomically: redeemed_by FKs to profiles.id, so the profile row has
  // to exist before the UPDATE can reference it; if the UPDATE returns
  // 0 rows (invite consumed/revoked/expired between /signup check and
  // the click) we roll the whole transaction back so the prospective
  // member doesn't end up with a profile but no invite link. The
  // single-row UPDATE guarded by the active predicates serializes
  // concurrent redeemers via row locks — exactly one winner.
  const displayName = (data.user.user_metadata?.displayName as string | undefined) ?? null;

  const userId = data.user.id;
  let result: { wasNewProfile: boolean } | null = null;
  try {
    result = await db.transaction(async (tx) => {
      // `xmax = 0` distinguishes a true insert from an ON CONFLICT
      // UPDATE so the auto-subscribe step only fires on first sign-in,
      // not when an existing member redeems a later invite.
      const inserted = await tx
        .insert(profiles)
        .values({ id: userId, displayName })
        .onConflictDoUpdate({
          target: profiles.id,
          set: {
            displayName: sql`coalesce(${profiles.displayName}, excluded.display_name)`,
          },
        })
        .returning({ id: profiles.id, created: sql<boolean>`xmax = 0` });

      const wasNewProfile = inserted[0]?.created === true;

      const rows = await tx
        .update(invites)
        .set({ redeemedBy: userId, redeemedAt: sql`now()` })
        .where(
          and(
            eq(invites.code, invite),
            isNull(invites.redeemedAt),
            isNull(invites.revokedAt),
            gt(invites.expiresAt, sql`now()`),
          ),
        )
        .returning({
          inviteId: invites.id,
          inviterId: invites.createdBy,
          relationValue: invites.relationValue,
        });

      if (rows.length === 0) {
        // Force rollback — no partial state survives.
        throw new InviteInvalid();
      }

      const { inviteId, inviterId, relationValue } = rows[0];

      await tx.update(profiles).set({ referredBy: inviterId }).where(eq(profiles.id, userId));

      // Materialize the inviter→redeemer rating (from relation_value)
      // and the redeemer→relatee hints (from invite_hints) into
      // relations rows. Same tx as the redemption itself so a failure
      // here rolls back the consumed invite — the new member never
      // ends up with a half-populated web.
      await materializeInviteRelations(tx, {
        inviteId,
        inviterId,
        redeemerId: userId,
        relationValue,
      });

      return { wasNewProfile };
    });
  } catch (err) {
    if (err instanceof InviteInvalid) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/signin?error=invite_invalid", request.url));
    }
    return NextResponse.redirect(new URL("/signin?error=profile_error", request.url));
  }

  if (!result) {
    return NextResponse.redirect(new URL("/signin?error=profile_error", request.url));
  }

  // Auto-subscribe runs outside the redemption transaction: it is
  // best-effort and a failure here must not roll back the consumed
  // invite or leave the new member signed out.
  if (result.wasNewProfile) {
    await tryAutoSubscribe(userId);
  }

  return NextResponse.redirect(new URL("/", request.url));
}

class InviteInvalid extends Error {}
