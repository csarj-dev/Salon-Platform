CREATE TABLE "deposit_code" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deposit_code_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client_id" integer NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"salt" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"proof_hash" text,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "deposit_code_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "deposit_code_proof_hash_unique" UNIQUE("proof_hash"),
	CONSTRAINT "deposit_code_attempts_valid" CHECK ("deposit_code"."attempts" >= 0),
	CONSTRAINT "deposit_code_proof_after_verified" CHECK ("deposit_code"."proof_hash" IS NULL OR "deposit_code"."verified_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "deposit_code" ADD CONSTRAINT "deposit_code_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposit_code_client_idx" ON "deposit_code" USING btree ("client_id","created_at");