import { sql } from "drizzle-orm";

import { db } from "./db";

// Per-member sign-in recency for the admin report. last_sign_in_at lives
// on auth.users, which schema.ts maps only partially (id + email, for
// FKs), so the whole query is raw SQL — same approach as
// system-metrics.ts. It records the last *full* sign-in, not the last
// visit: a member riding a live session only refreshes their token and
// keeps their old timestamp.
export type AdminSignin = {
  id: string;
  displayName: string | null;
  // ISO string; null = has never signed in.
  lastSignInAt: string | null;
  // Latest of last_sign_in_at and any live session's token refresh.
  // Session rows are deleted on sign-out, so this beats lastSignInAt
  // only for members with a session alive right now.
  lastActivityAt: string | null;
  hidden: boolean;
  deactivated: boolean;
};

export const listSigninsAdmin = async (): Promise<AdminSignin[]> => {
  // NULLS LAST puts never-signed-in members after everyone else, so the
  // API returns the report already in display order. sessions.refreshed_at
  // is the one auth column stored *without* a time zone (UTC by
  // convention), so it needs AT TIME ZONE 'UTC' before GREATEST can
  // compare it against last_sign_in_at.
  const rows = (await db.execute(sql`
    SELECT
      p.id,
      p.display_name,
      u.last_sign_in_at,
      GREATEST(u.last_sign_in_at, s.last_refreshed_at) AS last_activity_at,
      p.hidden,
      (p.deactivated_at IS NOT NULL) AS deactivated
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    LEFT JOIN (
      SELECT user_id, max(refreshed_at AT TIME ZONE 'UTC') AS last_refreshed_at
      FROM auth.sessions
      GROUP BY user_id
    ) s ON s.user_id = u.id
    ORDER BY u.last_sign_in_at DESC NULLS LAST, lower(p.display_name) ASC NULLS LAST, p.id
  `)) as unknown as {
    id: string;
    display_name: string | null;
    last_sign_in_at: Date | null;
    last_activity_at: Date | null;
    hidden: boolean;
    deactivated: boolean;
  }[];

  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    lastSignInAt: r.last_sign_in_at ? new Date(r.last_sign_in_at).toISOString() : null,
    lastActivityAt: r.last_activity_at ? new Date(r.last_activity_at).toISOString() : null,
    hidden: r.hidden,
    deactivated: r.deactivated,
  }));
};
