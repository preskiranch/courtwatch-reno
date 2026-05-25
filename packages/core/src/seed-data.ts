import { hashSource } from "./change-detection.js";
import { normalizeName, normalizeProgramName } from "./normalization.js";
import type {
  CourtWatchSnapshot,
  Division,
  DivisionResult,
  Game,
  GameChangeEvent,
  Player,
  ProgramAlias,
  ProgramTeamMatch,
  ProgramWatchlist,
  SyncRun,
  Team,
  TournamentEvent,
} from "./types.js";
import {
  SELECTED_TEAMS_PROGRAM_ID,
  SELECTED_TEAMS_PROGRAM_NAME,
} from "./types.js";
import { RENO_TIMEZONE } from "./types.js";

const now = new Date().toISOString();

export const seedEvent: TournamentEvent = {
  id: "event-reno-2026",
  exposureEventId: 255539,
  externalProvider: "exposure_events",
  externalId: "255539",
  slug: "2026-reno-memorial-day-tournament",
  sourceUrl:
    "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament",
  name: "2026 Reno Memorial Day Tournament",
  organizer: "Jam On It",
  sport: "basketball",
  sanctioningTags: ["Jam On It", "Exposure Events"],
  gender: "Boys & Girls",
  ageOrGradeDivisions: [],
  venueName: null,
  city: "Reno",
  state: "Nevada",
  region: "Nevada",
  startDate: "2026-05-23",
  endDate: "2026-05-25",
  location: "Reno, Nevada",
  officialUrl:
    "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament",
  timezone: RENO_TIMEZONE,
  registeredTeamCount: 9,
  hasPublicTeamList: true,
  lastCheckedAt: now,
  lastSyncedAt: now,
  lastTeamChangeAt: now,
  status: "active",
  dropdownGroup: "tracked",
};

export const seedPrograms: ProgramWatchlist[] = [
  {
    id: SELECTED_TEAMS_PROGRAM_ID,
    userId: null,
    programName: SELECTED_TEAMS_PROGRAM_NAME,
    normalizedProgramName: normalizeProgramName(SELECTED_TEAMS_PROGRAM_NAME),
    active: true,
    createdAt: now,
  },
];

export const seedAliases: ProgramAlias[] = [];

export const seedDivisions: Division[] = [
  division(
    "division-boys-3rd-orange",
    "5168259",
    "Boys 2nd/3rd Level 3 Orange",
    "Boys",
    "3RD",
    "Level 3 Orange",
  ),
  division(
    "division-boys-4th-green",
    "5168257",
    "Boys 4th Level 2 Green",
    "Boys",
    "4TH",
    "Level 2 Green",
  ),
  division(
    "division-boys-6th-blue",
    "5168258",
    "Boys 6th Level 2 Blue",
    "Boys",
    "6TH",
    "Level 2 Blue",
  ),
  division(
    "division-girls-7th-gold",
    "arsenal-girls-7",
    "Girls 7th Level 1 Gold",
    "Girls",
    "7TH",
    "Level 1 Gold",
  ),
  division(
    "division-boys-8th-black",
    "arsenal-boys-8",
    "Boys 8th Level 1 Black",
    "Boys",
    "8TH",
    "Level 1 Black",
  ),
];

export const seedTeams: Team[] = [
  team(
    "team-splash-3rd",
    "division-boys-3rd-orange",
    "5168259",
    "Splash City",
    "Splash City Basketball",
    "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/teams/splash-city?divisionteamid=5168259",
  ),
  team(
    "team-splash-4th",
    "division-boys-4th-green",
    "5168257",
    "Splash City",
    "Splash City Basketball",
    "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/teams/splash-city?divisionteamid=5168257",
  ),
  team(
    "team-splash-6th",
    "division-boys-6th-blue",
    "5168258",
    "Splash City",
    "SplashCity",
    "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/teams/splash-city?divisionteamid=5168258",
  ),
  team(
    "team-arsenal-girls-7",
    "division-girls-7th-gold",
    "arsenal-7001",
    "Arsenal 7th Grade Girls",
    "Arsenal Basketball",
    null,
  ),
  team(
    "team-arsenal-boys-8",
    "division-boys-8th-black",
    "arsenal-8001",
    "Team Arsenal 8th Black",
    "Team Arsenal",
    null,
  ),
  team(
    "team-premier-10u",
    "division-boys-4th-green",
    "opponent-10u",
    "Premier 10U Gold",
    null,
    null,
  ),
  team(
    "team-norcal-6",
    "division-boys-6th-blue",
    "opponent-norcal",
    "NorCal Elite Blue",
    null,
    null,
  ),
  team(
    "team-reno-girls",
    "division-girls-7th-gold",
    "opponent-reno",
    "Reno Ballers Girls 7th",
    null,
    null,
  ),
  team(
    "team-valley-8",
    "division-boys-8th-black",
    "opponent-valley",
    "Valley Kings 8th",
    null,
    null,
  ),
];

export const seedMatches: ProgramTeamMatch[] = [];
export const seedPlayers: Player[] = [];
export const seedDivisionResults: DivisionResult[] = [];

export const seedGames: Game[] = [
  game({
    id: "game-splash-4-next",
    exposureGameId: "mock-2001",
    divisionId: "division-boys-4th-green",
    gameNumber: "B4-22",
    gameType: "Pool",
    scheduledDate: "2026-05-23",
    scheduledTime: "2:40 PM",
    startsAt: "2026-05-23T21:40:00.000Z",
    venueName: "Reno-Sparks Convention Center",
    courtName: "Court 12",
    homeTeamId: "team-splash-4th",
    awayTeamId: "team-premier-10u",
    homeTeamNameSnapshot: "Splash City 4th",
    awayTeamNameSnapshot: "Premier 10U Gold",
    status: "upcoming",
  }),
  game({
    id: "game-splash-3-final",
    exposureGameId: "mock-1998",
    divisionId: "division-boys-3rd-orange",
    gameNumber: "B3-11",
    gameType: "Pool",
    scheduledDate: "2026-05-23",
    scheduledTime: "11:20 AM",
    startsAt: "2026-05-23T18:20:00.000Z",
    venueName: "Reno-Sparks Convention Center",
    courtName: "Court 08",
    homeTeamId: "team-splash-3rd",
    awayTeamId: null,
    homeTeamNameSnapshot: "Splash City 3rd",
    awayTeamNameSnapshot: "Bay Area Impact 9U",
    status: "upcoming",
  }),
  game({
    id: "game-splash-6-changed",
    exposureGameId: "mock-2018",
    divisionId: "division-boys-6th-blue",
    gameNumber: "B6-33",
    gameType: "Pool",
    scheduledDate: "2026-05-24",
    scheduledTime: "9:10 AM",
    startsAt: "2026-05-24T16:10:00.000Z",
    venueName: "Reno Events Center",
    courtName: "Court 31",
    homeTeamId: "team-norcal-6",
    awayTeamId: "team-splash-6th",
    homeTeamNameSnapshot: "NorCal Elite Blue",
    awayTeamNameSnapshot: "Splash City 6th",
    status: "schedule_changed",
  }),
  game({
    id: "game-arsenal-girls-next",
    exposureGameId: "mock-2044",
    divisionId: "division-girls-7th-gold",
    gameNumber: "G7-07",
    gameType: "Pool",
    scheduledDate: "2026-05-24",
    scheduledTime: "12:30 PM",
    startsAt: "2026-05-24T19:30:00.000Z",
    venueName: "Damonte Ranch High School",
    courtName: "Court 04",
    homeTeamId: "team-arsenal-girls-7",
    awayTeamId: "team-reno-girls",
    homeTeamNameSnapshot: "Arsenal 7th Grade Girls",
    awayTeamNameSnapshot: "Reno Ballers Girls 7th",
    status: "upcoming",
  }),
  game({
    id: "game-arsenal-bracket",
    exposureGameId: "mock-2099",
    divisionId: "division-boys-8th-black",
    gameNumber: "B8-QF2",
    gameType: "Bracket Quarterfinal",
    scheduledDate: "2026-05-25",
    scheduledTime: "10:00 AM",
    startsAt: "2026-05-25T17:00:00.000Z",
    venueName: "Reno-Sparks Convention Center",
    courtName: "Court 02",
    homeTeamId: "team-arsenal-boys-8",
    awayTeamId: "team-valley-8",
    homeTeamNameSnapshot: "Team Arsenal 8th Black",
    awayTeamNameSnapshot: "Valley Kings 8th",
    status: "awaiting_bracket",
  }),
];

export const seedChangeEvents: GameChangeEvent[] = [
  change(
    "change-splash-6-court",
    "game-splash-6-changed",
    "team-splash-6th",
    null,
    "court_changed",
    "Court 18",
    "Court 31",
  ),
  change(
    "change-arsenal-bracket",
    "game-arsenal-bracket",
    "team-arsenal-boys-8",
    null,
    "bracket_update",
    null,
    "Bracket Quarterfinal",
  ),
  change(
    "change-splash-4-time",
    "game-splash-4-next",
    "team-splash-4th",
    null,
    "game_time_changed",
    "2026-05-23T21:30:00.000Z",
    "2026-05-23T21:40:00.000Z",
  ),
];

export const seedSyncRuns: SyncRun[] = [
  {
    id: "sync-seed-1",
    eventId: seedEvent.id,
    startedAt: now,
    completedAt: now,
    status: "success",
    source: "mock",
    teamsCount: seedTeams.length,
    gamesCount: seedGames.length,
    changesDetected: seedChangeEvents.length,
    errorMessage: null,
  },
];

export const seedSnapshot: CourtWatchSnapshot = {
  event: seedEvent,
  events: [seedEvent],
  divisions: seedDivisions,
  teams: seedTeams,
  players: seedPlayers,
  divisionResults: seedDivisionResults,
  programs: seedPrograms,
  aliases: seedAliases,
  matches: seedMatches,
  games: seedGames,
  changeEvents: seedChangeEvents,
  syncRuns: seedSyncRuns,
};

function alias(
  id: string,
  programWatchlistId: string,
  aliasValue: string,
): ProgramAlias {
  return {
    id,
    programWatchlistId,
    alias: aliasValue,
    normalizedAlias: normalizeProgramName(aliasValue),
    createdAt: now,
  };
}

function division(
  id: string,
  exposureDivisionId: string,
  name: string,
  gender: string,
  gradeLevel: string,
  level: string,
): Division {
  return {
    id,
    eventId: seedEvent.id,
    exposureDivisionId,
    name,
    gender,
    gradeLevel,
    level,
    rawJson: { seeded: true },
  };
}

function team(
  id: string,
  divisionId: string,
  exposureTeamId: string,
  name: string,
  clubName: string | null,
  sourceUrl: string | null,
): Team {
  const divisionItem = seedDivisions.find((item) => item.id === divisionId);
  return {
    id,
    eventId: seedEvent.id,
    divisionId,
    exposureTeamId,
    name,
    normalizedName: normalizeName(name),
    clubName,
    normalizedClubName: clubName ? normalizeName(clubName) : null,
    coachName: null,
    sourceUrl,
    divisionName: divisionItem?.name ?? null,
    gender: divisionItem?.gender ?? null,
    gradeLevel: divisionItem?.gradeLevel ?? null,
    level: divisionItem?.level ?? null,
    rawJson: { seeded: true },
    lastSeenAt: now,
  };
}

function match(
  id: string,
  programWatchlistId: string,
  teamId: string,
  matchType: ProgramTeamMatch["matchType"],
  matchConfidence: number,
): ProgramTeamMatch {
  return {
    id,
    programWatchlistId,
    teamId,
    matchType,
    matchConfidence,
    active: true,
    createdAt: now,
  };
}

function game(
  input: Omit<
    Game,
    | "eventId"
    | "timezone"
    | "homeScore"
    | "awayScore"
    | "officialUrl"
    | "streamingUrl"
    | "updatedAt"
    | "sourceHash"
    | "rawJson"
  > &
    Partial<Pick<Game, "homeScore" | "awayScore">>,
): Game {
  const rawJson = { seeded: true, id: input.id };
  return {
    eventId: seedEvent.id,
    timezone: RENO_TIMEZONE,
    homeScore: input.homeScore ?? null,
    awayScore: input.awayScore ?? null,
    officialUrl: `${seedEvent.officialUrl}/schedule`,
    streamingUrl: null,
    updatedAt: now,
    sourceHash: hashSource(rawJson),
    rawJson,
    ...input,
  };
}

function change(
  id: string,
  gameId: string,
  affectedTeamId: string | null,
  affectedProgramWatchlistId: string | null,
  eventType: GameChangeEvent["eventType"],
  previousValue: unknown,
  newValue: unknown,
): GameChangeEvent {
  return {
    id,
    gameId,
    affectedTeamId,
    affectedProgramWatchlistId,
    eventType,
    previousValue,
    newValue,
    createdAt: now,
    notificationSent: false,
    dedupeKey: `${gameId}:${eventType}:${hashSource({ previousValue, newValue }).slice(0, 16)}`,
  };
}
