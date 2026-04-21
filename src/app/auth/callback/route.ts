import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/server/db";
import { upsertProfile } from "@/server/profiles";
import { invites, profiles } from "@/server/schema";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const invite = request.nextUrl.searchParams.get("invite");
  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=missing_code", request.url),
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(
      new URL("/login?error=exchange_failed", request.url),
    );
  }

  // Ordinary sign-in — Phase 1 upsert, referredBy stays null.
  if (!invite) {
    try {
      await upsertProfile(data.user);
    } catch {
      return NextResponse.redirect(
        new URL("/login?error=profile_error", request.url),
      );
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
  const displayName =
    (data.user.user_metadata?.displayName as string | undefined) ?? null;

  const userId = data.user.id;
  let ok = false;
  try {
    ok = await db.transaction(async (tx) => {
      await tx
        .insert(profiles)
        .values({ id: userId, displayName })
        .onConflictDoUpdate({
          target: profiles.id,
          set: {
            displayName: sql`coalesce(${profiles.displayName}, excluded.display_name)`,
          },
        });

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
        .returning({ inviterId: invites.createdBy });

      if (rows.length === 0) {
        // Force rollback — no partial state survives.
        throw new InviteInvalid();
      }

      await tx
        .update(profiles)
        .set({ referredBy: rows[0].inviterId })
        .where(eq(profiles.id, userId));

      return true;
    });
  } catch (err) {
    if (err instanceof InviteInvalid) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        new URL("/login?error=invite_invalid", request.url),
      );
    }
    return NextResponse.redirect(
      new URL("/login?error=profile_error", request.url),
    );
  }

  if (!ok) {
    return NextResponse.redirect(
      new URL("/login?error=profile_error", request.url),
    );
  }

  return NextResponse.redirect(new URL("/", request.url));
}

class InviteInvalid extends Error {}
