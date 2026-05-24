-- Additive table for final division placements. This migration does not alter
-- users, watchlists, followed teams, games, or existing tournament data.
CREATE TABLE "division_results" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "division_id" TEXT NOT NULL,
    "team_id" TEXT,
    "placement" INTEGER NOT NULL,
    "medal_label" TEXT NOT NULL,
    "bracket_label" TEXT,
    "team_name_snapshot" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_url" TEXT,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "source_hash" TEXT NOT NULL,
    "raw_json" JSONB,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "division_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "division_results_event_id_division_id_placement_key" ON "division_results"("event_id", "division_id", "placement");
CREATE INDEX "division_results_division_id_idx" ON "division_results"("division_id");
CREATE INDEX "division_results_team_id_idx" ON "division_results"("team_id");

ALTER TABLE "division_results" ADD CONSTRAINT "division_results_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "division_results" ADD CONSTRAINT "division_results_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "division_results" ADD CONSTRAINT "division_results_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
