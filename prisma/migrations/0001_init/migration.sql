-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "display_name" TEXT,
    "push_subscription_json" JSONB,
    "expo_push_token" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "exposure_event_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "organizer" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "location" TEXT NOT NULL,
    "official_url" TEXT NOT NULL,
    "last_synced_at" TIMESTAMP(3),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_watchlist" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "program_name" TEXT NOT NULL,
    "normalized_program_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_aliases" (
    "id" TEXT NOT NULL,
    "program_watchlist_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized_alias" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "divisions" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "exposure_division_id" TEXT,
    "name" TEXT NOT NULL,
    "gender" TEXT,
    "grade_level" TEXT,
    "level" TEXT,
    "raw_json" JSONB,

    CONSTRAINT "divisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "division_id" TEXT,
    "exposure_team_id" TEXT,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "club_name" TEXT,
    "normalized_club_name" TEXT,
    "coach_name" TEXT,
    "source_url" TEXT,
    "raw_json" JSONB,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_team_matches" (
    "id" TEXT NOT NULL,
    "program_watchlist_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "match_type" TEXT NOT NULL,
    "match_confidence" DECIMAL(5,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_team_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "division_id" TEXT,
    "exposure_game_id" TEXT,
    "game_number" TEXT,
    "game_type" TEXT,
    "scheduled_date" DATE NOT NULL,
    "scheduled_time" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "timezone" TEXT NOT NULL,
    "venue_name" TEXT,
    "court_name" TEXT,
    "home_team_id" TEXT,
    "away_team_id" TEXT,
    "home_team_name_snapshot" TEXT,
    "away_team_name_snapshot" TEXT,
    "home_score" INTEGER,
    "away_score" INTEGER,
    "status" TEXT NOT NULL,
    "official_url" TEXT,
    "streaming_url" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "source_hash" TEXT NOT NULL,
    "raw_json" JSONB,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_change_events" (
    "id" TEXT NOT NULL,
    "game_id" TEXT,
    "affected_team_id" TEXT,
    "affected_program_watchlist_id" TEXT,
    "event_type" TEXT NOT NULL,
    "previous_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notification_sent" BOOLEAN NOT NULL DEFAULT false,
    "dedupe_key" TEXT NOT NULL,

    CONSTRAINT "game_change_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "new_team_discovered" BOOLEAN NOT NULL DEFAULT true,
    "new_game_added" BOOLEAN NOT NULL DEFAULT true,
    "game_time_changed" BOOLEAN NOT NULL DEFAULT true,
    "court_changed" BOOLEAN NOT NULL DEFAULT true,
    "venue_changed" BOOLEAN NOT NULL DEFAULT true,
    "opponent_assigned" BOOLEAN NOT NULL DEFAULT true,
    "score_posted" BOOLEAN NOT NULL DEFAULT true,
    "final_score" BOOLEAN NOT NULL DEFAULT true,
    "bracket_update" BOOLEAN NOT NULL DEFAULT true,
    "game_start_reminder_minutes" INTEGER[] DEFAULT ARRAY[60, 30, 15]::INTEGER[],
    "daily_digest" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "game_change_event_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "dedupe_key" TEXT NOT NULL,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "teams_count" INTEGER NOT NULL DEFAULT 0,
    "games_count" INTEGER NOT NULL DEFAULT 0,
    "changes_detected" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "events_exposure_event_id_key" ON "events"("exposure_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_watchlist_user_id_normalized_program_name_key" ON "program_watchlist"("user_id", "normalized_program_name");

-- CreateIndex
CREATE UNIQUE INDEX "program_aliases_program_watchlist_id_normalized_alias_key" ON "program_aliases"("program_watchlist_id", "normalized_alias");

-- CreateIndex
CREATE UNIQUE INDEX "divisions_event_id_exposure_division_id_key" ON "divisions"("event_id", "exposure_division_id");

-- CreateIndex
CREATE INDEX "teams_normalized_name_idx" ON "teams"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "teams_event_id_exposure_team_id_key" ON "teams"("event_id", "exposure_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_team_matches_program_watchlist_id_team_id_key" ON "program_team_matches"("program_watchlist_id", "team_id");

-- CreateIndex
CREATE INDEX "games_starts_at_idx" ON "games"("starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "games_event_id_exposure_game_id_key" ON "games"("event_id", "exposure_game_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_change_events_dedupe_key_key" ON "game_change_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "game_change_events_created_at_idx" ON "game_change_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_log_user_id_dedupe_key_channel_key" ON "notification_log"("user_id", "dedupe_key", "channel");

-- CreateIndex
CREATE INDEX "sync_runs_started_at_idx" ON "sync_runs"("started_at");

-- AddForeignKey
ALTER TABLE "program_watchlist" ADD CONSTRAINT "program_watchlist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_aliases" ADD CONSTRAINT "program_aliases_program_watchlist_id_fkey" FOREIGN KEY ("program_watchlist_id") REFERENCES "program_watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_team_matches" ADD CONSTRAINT "program_team_matches_program_watchlist_id_fkey" FOREIGN KEY ("program_watchlist_id") REFERENCES "program_watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_team_matches" ADD CONSTRAINT "program_team_matches_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_change_events" ADD CONSTRAINT "game_change_events_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_change_events" ADD CONSTRAINT "game_change_events_affected_team_id_fkey" FOREIGN KEY ("affected_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_change_events" ADD CONSTRAINT "game_change_events_affected_program_watchlist_id_fkey" FOREIGN KEY ("affected_program_watchlist_id") REFERENCES "program_watchlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_game_change_event_id_fkey" FOREIGN KEY ("game_change_event_id") REFERENCES "game_change_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

