CREATE TABLE "invite_hints" (
	"invite_id" uuid NOT NULL,
	"ratee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_hints_invite_id_ratee_id_pk" PRIMARY KEY("invite_id","ratee_id")
);
--> statement-breakpoint
ALTER TABLE "invite_hints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "relations" (
	"rater_id" uuid NOT NULL,
	"ratee_id" uuid NOT NULL,
	"value" integer,
	"is_hint" boolean DEFAULT false NOT NULL,
	"hinted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relations_rater_id_ratee_id_pk" PRIMARY KEY("rater_id","ratee_id"),
	CONSTRAINT "relations_no_self" CHECK ("relations"."rater_id" != "relations"."ratee_id"),
	CONSTRAINT "relations_value_range" CHECK ("relations"."value" IS NULL OR ("relations"."value" BETWEEN 1 AND 4)),
	CONSTRAINT "relations_hint_state" CHECK ((NOT "relations"."is_hint" AND "relations"."value" IS NOT NULL)
       OR ("relations"."is_hint" AND "relations"."value" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "relations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "creator_value" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_updated_web" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invite_hints" ADD CONSTRAINT "invite_hints_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_hints" ADD CONSTRAINT "invite_hints_ratee_id_profiles_id_fk" FOREIGN KEY ("ratee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_rater_id_profiles_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_ratee_id_profiles_id_fk" FOREIGN KEY ("ratee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_hinted_by_profiles_id_fk" FOREIGN KEY ("hinted_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_creator_value_range" CHECK ("invites"."creator_value" IS NULL OR ("invites"."creator_value" BETWEEN 1 AND 4));