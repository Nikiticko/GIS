CREATE TABLE "telegram_attachment_deliveries" (
	"notification_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "telegram_attachment_deliveries_notification_id_attachment_id_pk" PRIMARY KEY("notification_id","attachment_id")
);
--> statement-breakpoint
ALTER TABLE "telegram_attachment_deliveries" ADD CONSTRAINT "telegram_attachment_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_attachment_deliveries" ADD CONSTRAINT "telegram_attachment_deliveries_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_attachment_deliveries_pending_idx" ON "telegram_attachment_deliveries" USING btree ("next_attempt_at") WHERE "telegram_attachment_deliveries"."sent_at" is null and "telegram_attachment_deliveries"."failed_at" is null;