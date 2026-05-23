CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "team_id" TEXT,
    "exposure_player_id" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "full_name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "jersey_number" TEXT,
    "position" TEXT,
    "grade" TEXT,
    "raw_json" JSONB,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "players_event_id_exposure_player_id_key" ON "players"("event_id", "exposure_player_id");
CREATE INDEX "players_normalized_name_idx" ON "players"("normalized_name");
CREATE INDEX "players_team_id_idx" ON "players"("team_id");

ALTER TABLE "players" ADD CONSTRAINT "players_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
