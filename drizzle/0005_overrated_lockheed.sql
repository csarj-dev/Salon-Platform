CREATE TABLE "service_translation" (
	"service_id" integer NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "service_translation_service_id_locale_pk" PRIMARY KEY("service_id","locale")
);
--> statement-breakpoint
ALTER TABLE "service_translation" ADD CONSTRAINT "service_translation_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;