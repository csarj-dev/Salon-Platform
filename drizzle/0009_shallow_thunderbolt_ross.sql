CREATE TABLE "location_photo" (
	"location_id" integer NOT NULL,
	"photo_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "location_photo_location_id_photo_id_pk" PRIMARY KEY("location_id","photo_id")
);
--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "location_photo" ADD CONSTRAINT "location_photo_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_photo" ADD CONSTRAINT "location_photo_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_slug_unique" UNIQUE("slug");
--> statement-breakpoint
UPDATE "location" AS l
SET "slug" = s.slug
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
             'location') AS base
    FROM "location"
  ) b
) s
WHERE l.id = s.id AND l."slug" IS NULL;