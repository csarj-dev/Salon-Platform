CREATE TABLE "staff_translation" (
	"staff_id" integer NOT NULL,
	"locale" text NOT NULL,
	"role" text,
	"bio" text,
	CONSTRAINT "staff_translation_staff_id_locale_pk" PRIMARY KEY("staff_id","locale")
);
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "listed_on_team_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_translation" ADD CONSTRAINT "staff_translation_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;