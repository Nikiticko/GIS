CREATE TABLE "login_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer NOT NULL
);

--> statement-breakpoint
UPDATE sessions SET id = 'sha256:' || encode(sha256(convert_to(id, 'UTF8')), 'hex') WHERE id ~ '^[a-f0-9]{64}$';
