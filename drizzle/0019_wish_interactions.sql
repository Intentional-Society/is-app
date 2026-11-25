CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reactable_type" text NOT NULL,
	"reactable_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_target_author_emoji_key" UNIQUE("reactable_type","reactable_id","author_id","emoji"),
	CONSTRAINT "reactions_emoji" CHECK ("reactions"."emoji" IN ('love', 'me_too', 'supportive', 'help'))
);
--> statement-breakpoint
ALTER TABLE "reactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commentable_type" text NOT NULL,
	"commentable_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reactions_target_idx" ON "reactions" USING btree ("reactable_type","reactable_id");--> statement-breakpoint
CREATE INDEX "comments_target_created_idx" ON "comments" USING btree ("commentable_type","commentable_id","created_at");
