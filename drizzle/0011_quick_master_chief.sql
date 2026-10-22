CREATE TABLE "service_photo" (
	"service_id" integer NOT NULL,
	"photo_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "service_photo_service_id_photo_id_pk" PRIMARY KEY("service_id","photo_id")
);
--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "service_translation" ADD COLUMN "long_description" text;--> statement-breakpoint
ALTER TABLE "service_photo" ADD CONSTRAINT "service_photo_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_photo" ADD CONSTRAINT "service_photo_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_slug_unique" UNIQUE("slug");
--> statement-breakpoint
UPDATE "service" AS s
SET "slug" = x.slug
FROM (
  SELECT id,
         CASE WHEN row_number() OVER (PARTITION BY base ORDER BY id) > 1
              THEN base || '-' || id
              ELSE base END AS slug
  FROM (
    SELECT id,
           COALESCE(
             NULLIF(
               trim(both '-' from regexp_replace(
                 translate(lower(name), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc'),
                 '[^a-z0-9]+', '-', 'g')),
               ''),
             'service') AS base
    FROM "service"
  ) b
) x
WHERE s.id = x.id AND s.slug IS NULL;