ALTER TABLE "events"
  ADD COLUMN "external_provider" TEXT NOT NULL DEFAULT 'exposure_events',
  ADD COLUMN "external_id" TEXT,
  ADD COLUMN "source_url" TEXT,
  ADD COLUMN "sport" TEXT NOT NULL DEFAULT 'basketball',
  ADD COLUMN "sanctioning_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "age_or_grade_divisions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "venue_name" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "region" TEXT,
  ADD COLUMN "registered_team_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "has_public_team_list" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_checked_at" TIMESTAMP(3),
  ADD COLUMN "last_team_change_at" TIMESTAMP(3),
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'upcoming',
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "events"
SET
  "external_id" = "exposure_event_id"::TEXT,
  "source_url" = "official_url",
  "city" = NULLIF(TRIM(SPLIT_PART("location", ',', 1)), ''),
  "state" = NULLIF(TRIM(SUBSTRING("location" FROM POSITION(',' IN "location") + 1)), ''),
  "region" = NULLIF(TRIM(SUBSTRING("location" FROM POSITION(',' IN "location") + 1)), ''),
  "registered_team_count" = COALESCE((
    SELECT COUNT(*)::INTEGER
    FROM "teams"
    WHERE "teams"."event_id" = "events"."id"
  ), 0),
  "has_public_team_list" = EXISTS (
    SELECT 1
    FROM "teams"
    WHERE "teams"."event_id" = "events"."id"
  ),
  "last_checked_at" = COALESCE("last_synced_at", CURRENT_TIMESTAMP),
  "last_team_change_at" = "last_synced_at",
  "status" = CASE
    WHEN "end_date" < CURRENT_DATE THEN 'completed'
    WHEN "start_date" <= CURRENT_DATE AND "end_date" >= CURRENT_DATE THEN 'active'
    ELSE 'upcoming'
  END;

ALTER TABLE "events" ALTER COLUMN "external_id" SET NOT NULL;

CREATE UNIQUE INDEX "events_external_provider_external_id_key" ON "events"("external_provider", "external_id");
CREATE INDEX "events_status_start_date_idx" ON "events"("status", "start_date");

ALTER TABLE "teams"
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
