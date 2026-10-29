CREATE TABLE "koibox_service_map" (
	"service_id" integer NOT NULL,
	"account" text NOT NULL,
	"koibox_service_id" integer NOT NULL,
	CONSTRAINT "koibox_service_map_service_id_account_pk" PRIMARY KEY("service_id","account"),
	CONSTRAINT "koibox_service_map_account_format" CHECK ("koibox_service_map"."account" ~ '^[a-z][a-z0-9_-]{0,31}$'),
	CONSTRAINT "koibox_service_map_id_positive" CHECK ("koibox_service_map"."koibox_service_id" > 0)
);
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "koibox_account" text;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "koibox_appointment_id" integer;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "koibox_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "koibox_error" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "koibox_account" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "koibox_user_id" integer;--> statement-breakpoint
ALTER TABLE "koibox_service_map" ADD CONSTRAINT "koibox_service_map_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_koibox_once" ON "appointment" USING btree ("koibox_account","koibox_appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_koibox_user_once" ON "staff" USING btree ("koibox_account","koibox_user_id");--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_koibox_id_has_account" CHECK ("appointment"."koibox_appointment_id" IS NULL OR "appointment"."koibox_account" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_koibox_error_length" CHECK ("appointment"."koibox_error" IS NULL OR char_length("appointment"."koibox_error") <= 500);--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_koibox_link_complete" CHECK (("staff"."koibox_account" IS NULL) = ("staff"."koibox_user_id" IS NULL));--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_koibox_account_format" CHECK ("staff"."koibox_account" IS NULL OR "staff"."koibox_account" ~ '^[a-z][a-z0-9_-]{0,31}$');