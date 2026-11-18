CREATE TABLE "wishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishes_status" CHECK ("wishes"."status" IN ('active', 'archived', 'fulfilled'))
);
--> statement-breakpoint
ALTER TABLE "wishes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wishes_author_status_idx" ON "wishes" USING btree ("author_id","status");