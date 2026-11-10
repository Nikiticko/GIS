CREATE TABLE "storage_deletion_jobs" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "storage_deletion_jobs_pending_idx" ON "storage_deletion_jobs" USING btree ("next_attempt_at");