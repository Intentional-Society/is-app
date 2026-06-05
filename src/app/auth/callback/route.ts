import * as Sentry from "@sentry/nextjs";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/server/db";
import { upsertProfile } from "@/server/profiles";
import { autoSubscribeNewMember } from "@/server/programs";
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

// The two `type` values our templates emit. Supabase's EmailOtpType is
// wider ("signup" | "invite" | "magiclink" | "email_change" | …) but
// we don't route any of those, so we narrow at the boundary instead of
// trusting the query string with an `as EmailOtpType` cast.
const ALLOWED_TYPES = ["email", "recovery"] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

const isAllowedType = (v: string | null): v is AllowedType =>
  v !== null && (ALLOWED_TYPES as readonly string[]).includes(v);

// `token_hash` and `invite` arrive verbatim from the query string and
// get reflected into the auto-submit form, so they must be neutralized
// to keep this page free of reflected HTML/script injection.
const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Interstitial that immediately POSTs back to this route to run the
// actual verification. Email link scanners (Microsoft Safe Links and
// friends) prefetch the link with a bare GET; verifying on GET would let
// that scan consume the single-use token before the member's real click
// lands, surfacing as `otp_expired` (issue #325). Scanners don't execute
// scripts or submit forms, so rendering this on GET and verifying only on
// POST keeps the token intact for the navigation that matters. <noscript>
// degrades to a manual Continue button for the rare JS-off client.
const transitPage = (params: { tokenHash: string; type: AllowedType; invite: string | null }): NextResponse => {
  const fields = [
    `<input type="hidden" name="token_hash" value="${escapeHtml(params.tokenHash)}">`,
    `<input type="hidden" name="type" value="${params.type}">`,
    params.invite ? `<input type="hidden" name="invite" value="${escapeHtml(params.invite)}">` : "",
  ].join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Signing you in…</title>
</head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:Canvas;color:CanvasText;">
  <main style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;">
    <p style="font-size:18px;margin:0;">Signing you in…</p>
    <form id="verify" method="POST" action="/auth/callback">
      ${fields}
      <noscript>
        <p style="font-size:14px;color:GrayText;margin:0 0 12px;">JavaScript is off — tap to continue.</p>
        <button type="submit" style="padding:12px 24px;font-size:16px;font-weight:bold;color:ButtonText;background:ButtonFace;border:1px solid ButtonBorder;border-radius:6px;cursor:pointer;">Continue</button>
      </noscript>
    </form>
    <script>document.getElementById("verify").submit();</script>
  </main>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Holds the one-time token — never let an intermediary cache it.
      "cache-control": "no-store",
    },
  });
};

// GET is the link target. It only renders the transit page; the token is
// never spent here (see transitPage). Missing/invalid params still bounce
// to /signin so a stray prefetch of a malformed link is harmless.
export function GET(request: NextRequest): NextResponse {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const invite = request.nextUrl.searchParams.get("invite");

  if (!tokenHash || !isAllowedType(type)) {
    return NextResponse.redirect(new URL("/signin?error=missing_token", request.url));
  }

  return transitPage({ tokenHash, type, invite });
}

// POST carries the verification. It runs only from the transit form's
// auto-submit (or the <noscript> button) — a real navigation, not a
// scanner's prefetch. Redirects use 303 so the browser follows them with
// a GET rather than re-POSTing to the destination.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();
  const tokenHashRaw = form.get("token_hash");
  const typeRaw = form.get("type");
  const inviteRaw = form.get("invite");

  const tokenHash = typeof tokenHashRaw === "string" ? tokenHashRaw : null;
  const type = typeof typeRaw === "string" ? typeRaw : null;
  if (!tokenHash || !isAllowedType(type)) {
    return NextResponse.redirect(new URL("/signin?error=missing_token", request.url), 303);
  }
  const invite = typeof inviteRaw === "string" && inviteRaw.length > 0 ? inviteRaw : null;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/signin?error=verify_failed", request.url), 303);
  }

  // Password reset — skip profile upsert, redirect to set-password page.
  if (type === "recovery") {
    return NextResponse.redirect(new URL("/auth/reset-password", request.url), 303);
  }

  // Ordinary sign-in — Phase 1 upsert, referredBy stays null.
  if (!invite) {
    let result: { created: boolean };
    try {
      result = await upsertProfile(data.user);
    } catch (err) {
      Sentry.captureException(err);
      return NextResponse.redirect(new URL("/signin?error=profile_error", request.url), 303);
    }
    if (result.created) {
      await tryAutoSubscribe(data.user.id);
    }
    return NextResponse.redirect(new URL("/", request.url), 303);
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
      return NextResponse.redirect(new URL("/signin?error=invite_invalid", request.url), 303);
    }
    // Anything other than InviteInvalid (the routine "code already
    // redeemed/expired" path) is a real Postgres/transaction failure —
    // capture it instead of swallowing it behind the generic redirect.
    Sentry.captureException(err);
    return NextResponse.redirect(new URL("/signin?error=profile_error", request.url), 303);
  }

  if (!result) {
    return NextResponse.redirect(new URL("/signin?error=profile_error", request.url), 303);
  }

  // Auto-subscribe runs outside the redemption transaction: it is
  // best-effort and a failure here must not roll back the consumed
  // invite or leave the new member signed out.
  if (result.wasNewProfile) {
    await tryAutoSubscribe(userId);
  }

  return NextResponse.redirect(new URL("/", request.url), 303);
}

class InviteInvalid extends Error {}
