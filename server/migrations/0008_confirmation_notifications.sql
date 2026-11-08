CREATE TABLE "notification_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"first_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"send_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "production_assignments" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "event_key" text;--> statement-breakpoint
ALTER TABLE "production_projects" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_batches" ADD CONSTRAINT "notification_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_batches" ADD CONSTRAINT "notification_batches_project_id_production_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."production_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_batches" ADD CONSTRAINT "notification_batches_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_batches_project_user_idx" ON "notification_batches" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "notification_batches_send_idx" ON "notification_batches" USING btree ("send_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_key_unique" UNIQUE("event_key");