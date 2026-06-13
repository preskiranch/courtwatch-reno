import type { TeamScoringLeader } from "./scoring-leaders.js";

export const DEFAULT_TOURNAMENT_TIMEZONE = "America/Los_Angeles";
export const RENO_TIMEZONE = DEFAULT_TOURNAMENT_TIMEZONE;
export const SELECTED_TEAMS_PROGRAM_ID = "program-selected-teams";
export const SELECTED_TEAMS_PROGRAM_NAME = "My Teams";
export const LEGACY_AUTO_PROGRAM_IDS = [
  "program-arsenal",
  "program-splash-city",
];

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
  | "final_placement"
  | "bracket_update"
  | "team_advanced"
  | "starting_soon";

export type ResultPlacement = 1 | 2 | 3;
export type ResultMedalLabel = "Gold" | "Silver" | "Bronze";
export type ResultSource =
  | "official_standings"
  | "bracket_final"
  | "manual_admin";
export type TournamentEventStatus =
  | "upcoming"
  | "active"
  | "completed"
  | "unavailable"
  | "cancelled";

export interface TournamentEvent {
  id: string;
  exposureEventId: number;
  externalProvider: string;
  externalId: string;
  slug: string;
  sourceUrl: string;
  name: string;
  organizer: string;
  sport: string;
  sanctioningTags: string[];
  gender: string | null;
  ageOrGradeDivisions: string[];
  venueName: string | null;
  city: string | null;
  state: string | null;
  region: string | null;
  startDate: string;
  endDate: string;
  location: string;
  officialUrl: string;
  timezone: string;
  registeredTeamCount: number;
  hasPublicTeamList: boolean;
  lastCheckedAt: string | null;
  lastSyncedAt: string | null;
  lastTeamChangeAt: string | null;
  status: TournamentEventStatus;
  dropdownGroup?: "tracked" | "upcoming";
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
  city?: string | null;
  state?: string | null;
  sourceUrl: string | null;
  divisionName?: string | null;
  gender?: string | null;
  gradeLevel?: string | null;
  level?: string | null;
  rawJson?: unknown;
  lastSeenAt: string;
  createdAt?: string;
  updatedAt?: string;
  exposureEventId?: number;
  eventName?: string;
  eventLocation?: string | null;
  playerNames?: string[];
  isFollowed?: boolean;
  followerCount?: number;
  record?: TeamRecordSummary;
}

export interface FavoriteTeamWatch {
  id: string;
  displayName: string;
  normalizedName: string;
  source: "registered" | "custom";
  sourceTeamId: string | null;
  sourceTeamName: string | null;
  eventName: string | null;
  divisionName: string | null;
  gender: string | null;
  gradeLevel: string | null;
  level: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FavoriteTeamWatchInput {
  displayName: string;
  sourceTeamId?: string | null;
  sourceTeamName?: string | null;
  eventName?: string | null;
  divisionName?: string | null;
  gender?: string | null;
  gradeLevel?: string | null;
  level?: string | null;
}

export interface TeamRecordSummary {
  wins: number;
  losses: number;
  ties: number;
  gamesScored: number;
  totalPoints: number;
  finalGames: number;
  gamesSeen: number;
}

export interface Player {
  id: string;
  eventId: string;
  teamId: string | null;
  exposurePlayerId: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  normalizedName: string;
  jerseyNumber: string | null;
  position: string | null;
  grade: string | null;
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
  homeTeamRecord?: TeamRecordSummary;
  awayTeamRecord?: TeamRecordSummary;
  status: GameStatus;
  officialUrl: string | null;
  streamingUrl: string | null;
  updatedAt: string;
  sourceHash: string;
  rawJson?: unknown;
}

export interface CourtFinderGame {
  game: Game;
  division: Division | null;
}

export interface CourtSummary {
  courtKey: string;
  courtName: string;
  venueName: string | null;
  currentGames: CourtFinderGame[];
  upNextGame: CourtFinderGame | null;
  recentGame: CourtFinderGame | null;
  games: CourtFinderGame[];
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

export interface SyncStatus {
  scope: "event" | "all";
  exposureEventId: number | null;
  lastSyncedAt: string | null;
  lastCheckedAt: string | null;
  lastTeamChangeAt: string | null;
  latestChangeAt: string | null;
  latestSuccessfulSyncAt: string | null;
  fingerprint: string;
}

export interface DivisionResult {
  id: string;
  eventId: string;
  divisionId: string;
  divisionName: string;
  gender: string | null;
  gradeLevel: string | null;
  level: string | null;
  teamId: string | null;
  teamNameSnapshot: string;
  teamSourceUrl: string | null;
  placement: ResultPlacement;
  medalLabel: ResultMedalLabel;
  bracketLabel: string | null;
  source: ResultSource;
  sourceUrl: string | null;
  isOfficial: boolean;
  sourceHash: string;
  rawJson?: unknown;
  lastSeenAt: string;
  record?: TeamRecordSummary;
}

export interface DivisionResultGroup {
  divisionId: string;
  divisionName: string;
  gender: string | null;
  gradeLevel: string | null;
  level: string | null;
  sourceUrl: string | null;
  lastUpdatedAt: string | null;
  isOfficial: boolean;
  rows: DivisionResult[];
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
  events: TournamentEvent[];
  nextGame: Game | null;
  programs: ProgramSummary[];
  pointsLeaders: TeamScoringLeader[];
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
  events: TournamentEvent[];
  divisions: Division[];
  teams: Team[];
  players: Player[];
  divisionResults: DivisionResult[];
  programs: ProgramWatchlist[];
  aliases: ProgramAlias[];
  matches: ProgramTeamMatch[];
  games: Game[];
  changeEvents: GameChangeEvent[];
  syncRuns: SyncRun[];
}

export const DISCLAIMER =
  "Court Watch AAU is an independent companion tracker and is not affiliated with Jam On It, AAU, or Exposure Events. Official schedules and rulings come from tournament staff.";
