export const RENO_TIMEZONE = "America/Los_Angeles";

export type GameStatus =
  | "upcoming"
  | "playing_now"
  | "final"
  | "awaiting_bracket"
  | "schedule_changed"
  | "unknown";

export type MatchType = "exact" | "normalized" | "fuzzy" | "alias" | "manual";

export type ChangeEventType =
  | "new_team_discovered"
  | "new_game_added"
  | "game_time_changed"
  | "date_changed"
  | "court_changed"
  | "venue_changed"
  | "opponent_assigned"
  | "home_away_changed"
  | "score_posted"
  | "final_score"
  | "bracket_update"
  | "team_advanced"
  | "starting_soon";

export interface TournamentEvent {
  id: string;
  exposureEventId: number;
  name: string;
  organizer: string;
  startDate: string;
  endDate: string;
  location: string;
  officialUrl: string;
  lastSyncedAt: string | null;
}

export interface Division {
  id: string;
  eventId: string;
  exposureDivisionId: string | null;
  name: string;
  gender: string | null;
  gradeLevel: string | null;
  level: string | null;
  rawJson?: unknown;
}

export interface Team {
  id: string;
  eventId: string;
  divisionId: string | null;
  exposureTeamId: string | null;
  name: string;
  normalizedName: string;
  clubName: string | null;
  normalizedClubName: string | null;
  coachName: string | null;
  sourceUrl: string | null;
  divisionName?: string | null;
  gender?: string | null;
  gradeLevel?: string | null;
  level?: string | null;
  rawJson?: unknown;
  lastSeenAt: string;
}

export interface ProgramWatchlist {
  id: string;
  userId: string | null;
  programName: string;
  normalizedProgramName: string;
  active: boolean;
  createdAt: string;
}

export interface ProgramAlias {
  id: string;
  programWatchlistId: string;
  alias: string;
  normalizedAlias: string;
  createdAt: string;
}

export interface ProgramTeamMatch {
  id: string;
  programWatchlistId: string;
  teamId: string;
  matchType: MatchType;
  matchConfidence: number;
  active: boolean;
  createdAt: string;
}

export interface Game {
  id: string;
  eventId: string;
  divisionId: string | null;
  exposureGameId: string | null;
  gameNumber: string | null;
  gameType: string | null;
  scheduledDate: string;
  scheduledTime: string;
  startsAt: string;
  timezone: string;
  venueName: string | null;
  courtName: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamNameSnapshot: string | null;
  awayTeamNameSnapshot: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: GameStatus;
  officialUrl: string | null;
  streamingUrl: string | null;
  updatedAt: string;
  sourceHash: string;
  rawJson?: unknown;
}

export interface GameChangeEvent {
  id: string;
  gameId: string | null;
  affectedTeamId: string | null;
  affectedProgramWatchlistId: string | null;
  eventType: ChangeEventType;
  previousValue: unknown;
  newValue: unknown;
  createdAt: string;
  notificationSent: boolean;
  dedupeKey: string;
}

export interface NotificationPreference {
  id: string;
  userId: string;
  newTeamDiscovered: boolean;
  newGameAdded: boolean;
  gameTimeChanged: boolean;
  courtChanged: boolean;
  venueChanged: boolean;
  opponentAssigned: boolean;
  scorePosted: boolean;
  finalScore: boolean;
  bracketUpdate: boolean;
  gameStartReminderMinutes: number[];
  dailyDigest: boolean;
}

export interface SyncRun {
  id: string;
  eventId: string;
  startedAt: string;
  completedAt: string | null;
  status: "success" | "failed" | "running";
  source: "exposure_api" | "public_page" | "mock";
  teamsCount: number;
  gamesCount: number;
  changesDetected: number;
  errorMessage: string | null;
}

export interface ProgramSummary {
  program: ProgramWatchlist;
  aliases: ProgramAlias[];
  teams: Array<
    Team & {
      matchType: MatchType;
      matchConfidence: number;
      nextGame: Game | null;
      lastResult: Game | null;
      liveStatus: GameStatus;
    }
  >;
  nextGame: Game | null;
  latestResult: Game | null;
  alertsCount: number;
  zeroStateMessage?: string;
}

export interface DashboardResponse {
  event: TournamentEvent;
  nextGame: Game | null;
  programs: ProgramSummary[];
  alerts: GameChangeEvent[];
  lastUpdated: string | null;
  sourceStatus: {
    source: SyncRun["source"];
    status: SyncRun["status"];
    lastSyncAt: string | null;
    message: string;
  };
  disclaimer: string;
}

export interface CourtWatchSnapshot {
  event: TournamentEvent;
  divisions: Division[];
  teams: Team[];
  programs: ProgramWatchlist[];
  aliases: ProgramAlias[];
  matches: ProgramTeamMatch[];
  games: Game[];
  changeEvents: GameChangeEvent[];
  syncRuns: SyncRun[];
}

export const DISCLAIMER =
  "CourtWatch Reno is an independent companion tracker and is not affiliated with Jam On It or Exposure Events. Official schedules and rulings come from tournament staff.";
