CREATE TABLE "photo" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "photo_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"storage_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "photo_size_positive" CHECK ("photo"."width" > 0 AND "photo"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "photo_translation" (
	"photo_id" integer NOT NULL,
	"locale" text NOT NULL,
	"alt" text NOT NULL,
	CONSTRAINT "photo_translation_photo_id_locale_pk" PRIMARY KEY("photo_id","locale"),
	CONSTRAINT "photo_translation_alt_not_blank" CHECK (length(btrim("photo_translation"."alt")) > 0)
);
--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "photo_id" integer;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "photo_id" integer;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "photo_id" integer;--> statement-breakpoint
ALTER TABLE "photo_translation" ADD CONSTRAINT "photo_translation_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE set null ON UPDATE no action;