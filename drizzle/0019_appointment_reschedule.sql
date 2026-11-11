ALTER TABLE "appointment" ADD COLUMN "koibox_previous_id" integer;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "rescheduled_at" timestamp with time zone;