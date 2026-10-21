CREATE TABLE "location_hours" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "location_hours_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"location_id" integer NOT NULL,
	"weekday" smallint NOT NULL,
	"open_time" time NOT NULL,
	"close_time" time NOT NULL,
	CONSTRAINT "location_hours_weekday_range" CHECK ("location_hours"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "location_hours_close_after_open" CHECK ("location_hours"."close_time" > "location_hours"."open_time")
);
--> statement-breakpoint
CREATE TABLE "service_category" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "service_category_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_category_translation" (
	"category_id" integer NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "service_category_translation_category_id_locale_pk" PRIMARY KEY("category_id","locale")
);
--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "maps_url" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "category_id" integer;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "requires_consultation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "location_hours" ADD CONSTRAINT "location_hours_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_category_translation" ADD CONSTRAINT "service_category_translation_category_id_service_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_category_id_service_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_category"("id") ON DELETE set null ON UPDATE no action;