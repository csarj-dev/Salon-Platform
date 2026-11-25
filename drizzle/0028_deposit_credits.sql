CREATE TABLE "deposit_credit" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deposit_credit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"client_id" integer NOT NULL,
	"source_appointment_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"category_id" integer,
	"service_id" integer,
	"collector" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_appointment_id" integer,
	CONSTRAINT "deposit_credit_amount_positive" CHECK ("deposit_credit"."amount_cents" > 0),
	CONSTRAINT "deposit_credit_expires_after_created" CHECK ("deposit_credit"."expires_at" > "deposit_credit"."created_at"),
	CONSTRAINT "deposit_credit_used_has_time" CHECK ("deposit_credit"."used_appointment_id" IS NULL OR "deposit_credit"."used_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "deposit_credit" ADD CONSTRAINT "deposit_credit_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_credit" ADD CONSTRAINT "deposit_credit_source_appointment_id_appointment_id_fk" FOREIGN KEY ("source_appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_credit" ADD CONSTRAINT "deposit_credit_category_id_service_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_credit" ADD CONSTRAINT "deposit_credit_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_credit" ADD CONSTRAINT "deposit_credit_used_appointment_id_appointment_id_fk" FOREIGN KEY ("used_appointment_id") REFERENCES "public"."appointment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposit_credit_client_idx" ON "deposit_credit" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "deposit_credit_source_idx" ON "deposit_credit" USING btree ("source_appointment_id");