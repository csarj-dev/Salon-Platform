ALTER TABLE "appointment" ADD COLUMN "deposit_validated_by" text;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_deposit_validated_by_user_id_fk" FOREIGN KEY ("deposit_validated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_cancel_reason_length" CHECK ("appointment"."cancel_reason" IS NULL OR char_length("appointment"."cancel_reason") <= 300);