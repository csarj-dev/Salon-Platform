ALTER TABLE "service" ADD COLUMN "deposit_cents" integer;
--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_deposit_positive" CHECK ("service"."deposit_cents" IS NULL OR "service"."deposit_cents" > 0);
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "deposit_cents" integer;
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "deposit_due_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "deposit_paid_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "public_token" uuid DEFAULT gen_random_uuid() NOT NULL;
--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_public_token_unique" UNIQUE("public_token");
--> statement-breakpoint
ALTER TABLE "appointment" DROP CONSTRAINT "appointment_no_overlap";
--> statement-breakpoint
ALTER TABLE "appointment" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TYPE "public"."appointment_status" RENAME TO "appointment_status_old";
--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'completed', 'cancelled', 'no_show', 'pending_deposit', 'expired');
--> statement-breakpoint
ALTER TABLE "appointment" ALTER COLUMN "status" SET DATA TYPE "public"."appointment_status" USING "status"::text::"public"."appointment_status";
--> statement-breakpoint
ALTER TABLE "appointment" ALTER COLUMN "status" SET DEFAULT 'booked';
--> statement-breakpoint
DROP TYPE "public"."appointment_status_old";
--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_no_overlap"
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'expired'));
--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_deposit_positive" CHECK ("appointment"."deposit_cents" IS NULL OR "appointment"."deposit_cents" > 0);
--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_pending_has_deposit" CHECK ("appointment"."status" <> 'pending_deposit' OR ("appointment"."deposit_cents" IS NOT NULL AND "appointment"."deposit_due_at" IS NOT NULL));
