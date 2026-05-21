ALTER TABLE "programs" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "signups_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Existing programs predate the closed-by-default policy and have been
-- accepting self-serve joins, so open them. New programs created after
-- this migration get the column default (false) and must be opened
-- explicitly by an admin.
UPDATE "programs" SET "signups_open" = true;