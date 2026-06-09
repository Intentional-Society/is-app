import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { vi } from "vitest";

import { db } from "@/server/db";
import { invites, profiles, relations } from "@/server/schema";

// Shared helpers for the relations test files (relations, relations-personal,
// relations-mini-map). Each test file still declares its own
// vi.mock("@supabase/ssr") — that call is hoisted per-file and can't be moved
// here — but everything below lives once.

export const fakeUser = (id: string): User =>
  ({
    id,
    email: `${id}@testfake.local`,
    user_metadata: {},
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  }) as User;

// Point the mocked Supabase server client at `userId` for subsequent requests.
export const authAs = (userId: string) => {
  vi.mocked(createServerClient).mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: fakeUser(userId) },
        error: null,
      }),
    },
    // biome-ignore lint/suspicious/noExplicitAny: test mock shape
  } as any);
};

// Clear the auth mock between tests (afterEach).
export const resetAuth = () => {
  vi.mocked(createServerClient).mockReset();
};

export const insertUserAndProfile = async (id: string, opts: { displayName?: string; isAdmin?: boolean } = {}) => {
  await db.execute(
    sql`INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) VALUES (${id}::uuid, ${`${id}@testfake.local`}, false, false)`,
  );
  await db.insert(profiles).values({
    id,
    displayName: opts.displayName ?? null,
    isAdmin: opts.isAdmin ?? false,
  });
};

export const deleteUserAndProfile = async (id: string) => {
  await db.delete(relations).where(eq(relations.relatorId, id));
  await db.delete(relations).where(eq(relations.relateeId, id));
  await db.delete(invites).where(eq(invites.createdBy, id));
  await db.delete(profiles).where(eq(profiles.id, id));
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
};
