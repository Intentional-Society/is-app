ALTER TABLE "programs" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;