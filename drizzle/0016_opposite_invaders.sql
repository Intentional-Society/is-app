CREATE TABLE "message_box_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_box_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_box_settings" (
	"program_id" uuid PRIMARY KEY NOT NULL,
	"visibility" text DEFAULT 'admins' NOT NULL,
	CONSTRAINT "message_box_settings_visibility" CHECK ("message_box_settings"."visibility" IN ('members', 'admins'))
);
--> statement-breakpoint
ALTER TABLE "message_box_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program_features" (
	"program_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_features_program_id_feature_key_pk" PRIMARY KEY("program_id","feature_key")
);
--> statement-breakpoint
ALTER TABLE "program_features" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message_box_messages" ADD CONSTRAINT "message_box_messages_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_box_messages" ADD CONSTRAINT "message_box_messages_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_box_settings" ADD CONSTRAINT "message_box_settings_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_features" ADD CONSTRAINT "program_features_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_box_messages_program_created_idx" ON "message_box_messages" USING btree ("program_id","created_at");