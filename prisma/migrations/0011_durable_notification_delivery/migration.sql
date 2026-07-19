-- Convert notification delivery from a best-effort write into a durable queue.
-- Existing sent/failed rows are retained and become immediately inspectable.

ALTER TABLE "notification_log"
  ALTER COLUMN "sent_at" DROP NOT NULL,
  ALTER COLUMN "sent_at" DROP DEFAULT,
  ADD COLUMN "click_url" TEXT,
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_attempt_at" TIMESTAMP(3),
  ADD COLUMN "last_attempt_at" TIMESTAMP(3),
  ADD COLUMN "delivered_at" TIMESTAMP(3),
  ADD COLUMN "dead_lettered_at" TIMESTAMP(3),
  ADD COLUMN "lease_expires_at" TIMESTAMP(3);

UPDATE "notification_log"
SET
  "attempt_count" = CASE WHEN "status" IN ('sent', 'failed') THEN 1 ELSE 0 END,
  "last_attempt_at" = CASE WHEN "status" IN ('sent', 'failed') THEN "sent_at" ELSE NULL END,
  "delivered_at" = CASE WHEN "status" = 'sent' THEN "sent_at" ELSE NULL END,
  "next_attempt_at" = CASE WHEN "status" = 'failed' THEN CURRENT_TIMESTAMP ELSE NULL END,
  "status" = CASE WHEN "status" = 'failed' THEN 'retry' ELSE "status" END;

CREATE INDEX "notification_log_status_next_attempt_idx"
  ON "notification_log"("status", "next_attempt_at");
CREATE INDEX "notification_log_status_lease_idx"
  ON "notification_log"("status", "lease_expires_at");
CREATE INDEX "notification_log_change_status_idx"
  ON "notification_log"("game_change_event_id", "status");
