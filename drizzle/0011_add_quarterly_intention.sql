ALTER TABLE "profiles" ADD COLUMN "current_intention" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "intention_updated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "profiles" SET "current_intention" = "live_desire", "intention_updated_at" = now() WHERE "live_desire" IS NOT NULL AND "current_intention" IS NULL;