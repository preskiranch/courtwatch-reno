-- Global team watches are intentionally separate from tournament-specific
-- follows. A watch identifies one exact normalized team name and records each
-- tournament registration discovered for it.

ALTER TABLE "favorite_team_watches"
  ADD COLUMN "user_id" TEXT,
  ADD COLUMN "auto_follow" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_matched_at" TIMESTAMP(3);

-- The original prototype allowed one row per source team. Collapse those rows
-- to one durable watch per owner and normalized identity before enforcing the
-- new invariant. Prefer active and most recently updated rows.
WITH ranked_watches AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "owner_hash", "normalized_name"
      ORDER BY "active" DESC, "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS row_number
  FROM "favorite_team_watches"
)
DELETE FROM "favorite_team_watches"
WHERE "id" IN (
  SELECT "id" FROM ranked_watches WHERE row_number > 1
);

CREATE UNIQUE INDEX "favorite_team_watches_owner_hash_normalized_name_key"
  ON "favorite_team_watches"("owner_hash", "normalized_name");

ALTER TABLE "favorite_team_watches"
  ADD CONSTRAINT "favorite_team_watches_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "favorite_team_registration_matches" (
  "id" TEXT NOT NULL,
  "favorite_team_watch_id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "auto_follow_applied_at" TIMESTAMP(3),

  CONSTRAINT "favorite_team_registration_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "favorite_team_registration_matches_favorite_team_watch_id_team_id_key"
  ON "favorite_team_registration_matches"("favorite_team_watch_id", "team_id");
CREATE INDEX "favorite_team_registration_matches_watch_event_idx"
  ON "favorite_team_registration_matches"("favorite_team_watch_id", "event_id");
CREATE INDEX "favorite_team_registration_matches_team_idx"
  ON "favorite_team_registration_matches"("team_id");
CREATE INDEX "favorite_team_registration_matches_event_idx"
  ON "favorite_team_registration_matches"("event_id");

ALTER TABLE "favorite_team_registration_matches"
  ADD CONSTRAINT "favorite_team_registration_matches_favorite_team_watch_id_fkey"
  FOREIGN KEY ("favorite_team_watch_id") REFERENCES "favorite_team_watches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "favorite_team_registration_matches"
  ADD CONSTRAINT "favorite_team_registration_matches_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "favorite_team_registration_matches"
  ADD CONSTRAINT "favorite_team_registration_matches_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "game_change_events"
  ADD COLUMN "favorite_team_watch_id" TEXT;

CREATE INDEX "game_change_events_favorite_watch_id_created_at_idx"
  ON "game_change_events"("favorite_team_watch_id", "created_at");

ALTER TABLE "game_change_events"
  ADD CONSTRAINT "game_change_events_favorite_team_watch_id_fkey"
  FOREIGN KEY ("favorite_team_watch_id") REFERENCES "favorite_team_watches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
