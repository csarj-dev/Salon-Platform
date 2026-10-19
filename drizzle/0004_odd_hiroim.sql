CREATE TABLE "location" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "location_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_service" (
	"location_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"price_cents" integer,
	CONSTRAINT "location_service_location_id_service_id_pk" PRIMARY KEY("location_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "location_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "location_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "location_service" ADD CONSTRAINT "location_service_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_service" ADD CONSTRAINT "location_service_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;