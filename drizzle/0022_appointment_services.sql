CREATE TABLE "appointment_service" (
	"appointment_id" integer NOT NULL,
	"position" smallint NOT NULL,
	"service_id" integer NOT NULL,
	"duration_min" integer NOT NULL,
	"price_cents" integer NOT NULL,
	CONSTRAINT "appointment_service_appointment_id_position_pk" PRIMARY KEY("appointment_id","position"),
	CONSTRAINT "appointment_service_position_valid" CHECK ("appointment_service"."position" >= 0),
	CONSTRAINT "appointment_service_duration_positive" CHECK ("appointment_service"."duration_min" > 0),
	CONSTRAINT "appointment_service_price_valid" CHECK ("appointment_service"."price_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "appointment_service" ADD CONSTRAINT "appointment_service_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_service" ADD CONSTRAINT "appointment_service_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_service_once" ON "appointment_service" USING btree ("appointment_id","service_id");
--> statement-breakpoint
-- Cada cita que ya existía pasa a tener una línea: su servicio, con los minutos del servicio
-- y el precio que se le aplicó
INSERT INTO "appointment_service" ("appointment_id", "position", "service_id", "duration_min", "price_cents")
SELECT a."id", 0, a."service_id", s."duration_min", a."price_applied_cents"
FROM "appointment" a
JOIN "service" s ON s."id" = a."service_id";