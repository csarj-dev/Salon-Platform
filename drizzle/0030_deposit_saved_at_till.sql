ALTER TYPE "public"."email_kind" ADD VALUE 'deposit_saved';--> statement-breakpoint
ALTER TABLE "deposit_credit" ADD COLUMN "origin" text DEFAULT 'cancelled' NOT NULL;--> statement-breakpoint
ALTER TABLE "deposit_credit" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "deposit_credit" ADD CONSTRAINT "deposit_credit_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_credit" ADD CONSTRAINT "deposit_credit_origin_valid" CHECK ("deposit_credit"."origin" IN ('cancelled', 'paid_in_full'));