CREATE TYPE "public"."appointment_source" AS ENUM('web', 'phone', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TABLE "appointment" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "appointment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"client_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"performed_by_staff_id" integer,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"price_applied_cents" integer NOT NULL,
	"source" "appointment_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "ends_after_starts" CHECK ("appointment"."ends_at" > "appointment"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "client_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"consent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_performed_by_staff_id_staff_id_fk" FOREIGN KEY ("performed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;