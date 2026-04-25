import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Supabase's auth.users table — referenced for FK purposes only.
// drizzle-kit is configured with schemaFilter: ["public"] so it will
// not attempt to create or alter this table.
const authSchema = pgSchema("auth");
const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

// All public tables have RLS enabled with no policies. Drizzle connects as the
// `postgres` superuser, which bypasses RLS, so the app is unaffected. The
// hosted Data API is also disabled (see docs/doc-supabase.md), so the anon /
// authenticated roles have no path to these tables — RLS is the backstop in
// case that toggle ever flips on.

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id),
  displayName: text("display_name"),
  bio: text("bio"),
  keywords: text("keywords")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  location: text("location"),
  supplementaryInfo: text("supplementary_info"),
  referredBy: uuid("referred_by").references((): AnyPgColumn => profiles.id, {
    onDelete: "set null",
  }),
  referredByLegacy: text("referred_by_legacy"),
  avatarUrl: text("avatar_url"),
  emergencyContact: text("emergency_contact"),
  liveDesire: text("live_desire"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();

export const programs = pgTable("programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

export const profilePrograms = pgTable(
  "profile_programs",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.programId] })],
).enableRLS();

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedBy: uuid("redeemed_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "invites_redemption_pair",
      sql`(${table.redeemedBy} IS NULL) = (${table.redeemedAt} IS NULL)`,
    ),
    check(
      "invites_expires_after_created",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
).enableRLS();
