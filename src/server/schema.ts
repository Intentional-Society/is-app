import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  integer,
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
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email"),
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
  slug: text("slug").unique(),
  bio: text("bio"),
  keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
  location: text("location"),
  supplementaryInfo: text("supplementary_info"),
  referredBy: uuid("referred_by").references((): AnyPgColumn => profiles.id, {
    onDelete: "set null",
  }),
  referredByLegacy: text("referred_by_legacy"),
  // SQL column stays "avatar_url" until a rename migration lands; the
  // TS name follows the post-#131 meaning — a Supabase Storage object
  // path, not a URL. See docs/design-profile-pictures.md.
  avatarPath: text("avatar_url"),
  emergencyContact: text("emergency_contact"),
  isAdmin: boolean("is_admin").notNull().default(false),
  // Hidden profiles are invisible to non-admin members everywhere —
  // directory, suggestions, web, typeaheads. Admins still see them so
  // the flag is reversible. See docs/devjournal.md (#168).
  hidden: boolean("hidden").notNull().default(false),
  lastSignedAgreements: timestamp("last_signed_agreements", { withTimezone: true }),
  lastUpdatedProfile: timestamp("last_updated_profile", { withTimezone: true }),
  lastReviewedPrograms: timestamp("last_reviewed_programs", { withTimezone: true }),
  currentIntention: text("current_intention"),
  intentionUpdatedAt: timestamp("intention_updated_at", { withTimezone: true }),
  lastUpdatedWeb: timestamp("last_updated_web", { withTimezone: true }),
  // Buttondown subscriber id — populated lazily by the sync the first
  // time it encounters this profile. Lookups by id are stable across
  // member email changes; the cron PATCHes the subscriber's email when
  // it sees a mismatch. See docs/design-buttondown.md.
  buttondownSubscriberId: text("buttondown_subscriber_id"),
  // Set by the member themselves via POST /me/deactivate. Deactivated profiles
  // are hidden from all member-facing views. Admins can reactivate by clearing
  // the field. Distinct from `hidden` which is an admin-only test-account flag.
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  hasPassword: boolean("has_password").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  // Archived programs are hidden from member-facing listings (admins
  // still see them in /admin/programs). Set the timestamp instead of
  // a boolean — it's strictly more information.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  // Gates the member-facing self-serve join. Closed by default so a
  // newly-created cohort or pod doesn't accidentally accept signups
  // before the admin is ready; admin add-participant is unaffected.
  signupsOpen: boolean("signups_open").notNull().default(false),
  // Buttondown tag name for this program. NULL means "do not sync this
  // program to Buttondown at all" — the per-program opt-in mechanism.
  // The value is the exact tag string Buttondown stores; admins set it
  // to match whatever tag the newsletter already uses for this program.
  // See docs/design-buttondown.md.
  buttondownTag: text("buttondown_tag"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// Lease-based concurrency lock for sync jobs (currently just Buttondown).
// One row per actively held lock; the row is deleted on release, so the
// table is empty when nothing is running. Acquire via INSERT ... ON
// CONFLICT DO UPDATE WHERE expired (see docs/design-buttondown.md).
export const syncLocks = pgTable("sync_locks", {
  name: text("name").primaryKey(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
  acquiredBy: text("acquired_by").notNull(),
}).enableRLS();

// Soft-delete table: a row's existence records "Alice was ever joined
// to this program"; leftAt distinguishes "currently joined" (NULL) from
// "left, history preserved" (timestamp). assignedAt is set once on
// first insert and never updated, so it survives leave/rejoin cycles
// as the stable first-joined date.
export const profilePrograms = pgTable(
  "profile_programs",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedBy: uuid("redeemed_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // SQL column stays "creator_value" until a rename migration lands;
    // the TS-side name follows the post-review vocabulary.
    relationValue: integer("creator_value"),
  },
  (table) => [
    check("invites_redemption_pair", sql`(${table.redeemedBy} IS NULL) = (${table.redeemedAt} IS NULL)`),
    check("invites_expires_after_created", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "invites_creator_value_range",
      sql`${table.relationValue} IS NULL OR (${table.relationValue} BETWEEN 1 AND 4)`,
    ),
  ],
).enableRLS();

export const relations = pgTable(
  "relations",
  {
    // SQL columns stay rater_id / ratee_id until a rename migration
    // lands; TS-side names follow the post-review vocabulary.
    relatorId: uuid("rater_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    relateeId: uuid("ratee_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    value: integer("value"),
    isHint: boolean("is_hint").notNull().default(false),
    hintedBy: uuid("hinted_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.relatorId, table.relateeId] }),
    check("relations_no_self", sql`${table.relatorId} != ${table.relateeId}`),
    check("relations_value_range", sql`${table.value} IS NULL OR (${table.value} BETWEEN 1 AND 4)`),
    check(
      "relations_hint_state",
      sql`(NOT ${table.isHint} AND ${table.value} IS NOT NULL)
       OR (${table.isHint} AND ${table.value} IS NULL)`,
    ),
  ],
).enableRLS();

export const inviteHints = pgTable(
  "invite_hints",
  {
    inviteId: uuid("invite_id")
      .notNull()
      .references(() => invites.id, { onDelete: "cascade" }),
    relateeId: uuid("ratee_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.inviteId, table.relateeId] })],
).enableRLS();
