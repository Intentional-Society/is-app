CREATE TABLE "sync_locks" (
	"name" text PRIMARY KEY NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"acquired_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_locks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "buttondown_subscriber_id" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "buttondown_tag" text;
