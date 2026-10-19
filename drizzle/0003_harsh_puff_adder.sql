CREATE TABLE "schedule" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "schedule_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"staff_id" integer NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	CONSTRAINT "weekday_range" CHECK ("schedule"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "schedule_end_after_start" CHECK ("schedule"."end_time" > "schedule"."start_time")
);
--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "time_off_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"staff_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	CONSTRAINT "time_off_ends_after_starts" CHECK ("time_off"."ends_at" > "time_off"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;