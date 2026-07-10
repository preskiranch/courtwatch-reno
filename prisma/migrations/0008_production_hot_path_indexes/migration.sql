-- Hot-path indexes for tournament selection, team search, schedules, alerts,
-- notification dispatch, and sync status reads. These are additive and safe for
-- existing production data.

CREATE INDEX IF NOT EXISTS "events_region_status_start_date_idx"
  ON "events"("region", "status", "start_date");

CREATE INDEX IF NOT EXISTS "events_start_end_date_idx"
  ON "events"("start_date", "end_date");

CREATE INDEX IF NOT EXISTS "events_last_checked_at_idx"
  ON "events"("last_checked_at");

CREATE INDEX IF NOT EXISTS "divisions_event_id_idx"
  ON "divisions"("event_id");

CREATE INDEX IF NOT EXISTS "teams_event_id_normalized_name_idx"
  ON "teams"("event_id", "normalized_name");

CREATE INDEX IF NOT EXISTS "teams_event_id_division_id_idx"
  ON "teams"("event_id", "division_id");

CREATE INDEX IF NOT EXISTS "program_team_matches_team_id_idx"
  ON "program_team_matches"("team_id");

CREATE INDEX IF NOT EXISTS "program_team_matches_program_active_idx"
  ON "program_team_matches"("program_watchlist_id", "active");

CREATE INDEX IF NOT EXISTS "games_event_id_starts_at_idx"
  ON "games"("event_id", "starts_at");

CREATE INDEX IF NOT EXISTS "games_event_id_status_starts_at_idx"
  ON "games"("event_id", "status", "starts_at");

CREATE INDEX IF NOT EXISTS "games_home_team_id_starts_at_idx"
  ON "games"("home_team_id", "starts_at");

CREATE INDEX IF NOT EXISTS "games_away_team_id_starts_at_idx"
  ON "games"("away_team_id", "starts_at");

CREATE INDEX IF NOT EXISTS "games_division_id_starts_at_idx"
  ON "games"("division_id", "starts_at");

CREATE INDEX IF NOT EXISTS "game_change_events_game_id_created_at_idx"
  ON "game_change_events"("game_id", "created_at");

CREATE INDEX IF NOT EXISTS "game_change_events_team_id_created_at_idx"
  ON "game_change_events"("affected_team_id", "created_at");

CREATE INDEX IF NOT EXISTS "game_change_events_watchlist_id_created_at_idx"
  ON "game_change_events"("affected_program_watchlist_id", "created_at");

CREATE INDEX IF NOT EXISTS "game_change_events_notification_created_at_idx"
  ON "game_change_events"("notification_sent", "created_at");

CREATE INDEX IF NOT EXISTS "division_results_event_division_idx"
  ON "division_results"("event_id", "division_id");

CREATE INDEX IF NOT EXISTS "division_results_event_team_idx"
  ON "division_results"("event_id", "team_id");

CREATE INDEX IF NOT EXISTS "notification_log_user_sent_at_idx"
  ON "notification_log"("user_id", "sent_at");

CREATE INDEX IF NOT EXISTS "notification_log_status_sent_at_idx"
  ON "notification_log"("status", "sent_at");

CREATE INDEX IF NOT EXISTS "favorite_team_watches_owner_active_idx"
  ON "favorite_team_watches"("owner_hash", "active");

CREATE INDEX IF NOT EXISTS "sync_runs_event_status_completed_idx"
  ON "sync_runs"("event_id", "status", "completed_at");

CREATE INDEX IF NOT EXISTS "sync_runs_event_started_idx"
  ON "sync_runs"("event_id", "started_at");
