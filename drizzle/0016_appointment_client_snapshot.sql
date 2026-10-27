ALTER TABLE "appointment" ADD COLUMN "client_name" text;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "client_email" text;--> statement-breakpoint
UPDATE "appointment" AS a SET "client_name" = c."name", "client_email" = c."email" FROM "client" AS c WHERE c."id" = a."client_id";--> statement-breakpoint
ALTER TABLE "appointment" ALTER COLUMN "client_name" SET NOT NULL;