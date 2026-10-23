CREATE TYPE "public"."email_kind" AS ENUM('confirmation', 'cancellation', 'reminder');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "email_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"appointment_id" integer NOT NULL,
	"kind" "email_kind" NOT NULL,
	"to_email" text NOT NULL,
	"status" "email_status" DEFAULT 'pending' NOT NULL,
	"provider_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_log_appointment_idx" ON "email_log" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_log_reminder_once" ON "email_log" USING btree ("appointment_id") WHERE "email_log"."kind" = 'reminder' AND "email_log"."status" <> 'failed';