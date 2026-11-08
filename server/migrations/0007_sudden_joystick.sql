DROP INDEX "telegram_deliveries_pending_idx";--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "telegram_deliveries_pending_idx" ON "telegram_deliveries" USING btree ("next_attempt_at") WHERE "telegram_deliveries"."sent_at" is null and "telegram_deliveries"."failed_at" is null;