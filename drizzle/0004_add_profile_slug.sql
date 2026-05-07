ALTER TABLE "profiles" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_slug_unique" UNIQUE("slug");