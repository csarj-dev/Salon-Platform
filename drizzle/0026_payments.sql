CREATE TYPE "public"."payment_status" AS ENUM('created', 'paid', 'failed', 'refunded');--> statement-breakpoint
CREATE TABLE "payment" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"appointment_id" integer NOT NULL,
	"collector" text NOT NULL,
	"environment" text NOT NULL,
	"merchant_code" text NOT NULL,
	"terminal" smallint NOT NULL,
	"order_code" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "payment_status" DEFAULT 'created' NOT NULL,
	"response_code" integer,
	"auth_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	CONSTRAINT "payment_order_code_unique" UNIQUE("order_code"),
	CONSTRAINT "payment_amount_positive" CHECK ("payment"."amount_cents" > 0),
	CONSTRAINT "payment_environment_valid" CHECK ("payment"."environment" IN ('test', 'live')),
	CONSTRAINT "payment_order_code_format" CHECK ("payment"."order_code" ~ '^[0-9]{4}[0-9A-Za-z]{8}$'),
	CONSTRAINT "payment_terminal_valid" CHECK ("payment"."terminal" BETWEEN 1 AND 999),
	CONSTRAINT "payment_notified_has_time" CHECK ("payment"."status" = 'created' OR "payment"."notified_at" IS NOT NULL),
	CONSTRAINT "payment_refunded_has_time" CHECK ("payment"."status" <> 'refunded' OR "payment"."refunded_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_appointment_idx" ON "payment" USING btree ("appointment_id");