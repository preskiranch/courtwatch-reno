import { dedupeKey, hashSource } from "./change-detection.js";
import { sanitizeBasketballScore } from "./score-utils.js";
import type {
  CourtWatchSnapshot,
  DivisionResult,
  DivisionResultGroup,
  Game,
  ResultMedalLabel,
  ResultPlacement,
  Team,
  TeamRecordSummary,
} from "./types.js";

const placementMedals: Record<ResultPlacement, ResultMedalLabel> = {
  1: "Gold",
  2: "Silver",
  3: "Bronze",
};

type ResultTeam = {
  id: string | null;
  name: string;
  sourceUrl: string | null;
  nameSnapshot: string;
};

export function deriveDivisionResultsFromGames(
  snapshot: Pick<CourtWatchSnapshot, "event" | "divisions" | "teams" | "games">,
): DivisionResult[] {
  const results: DivisionResult[] = [];
  const gamesByDivision = new Map<string, Game[]>();

  for (const game of snapshot.games) {
    const homeScore = sanitizeBasketballScore(game.homeScore);
    const awayScore = sanitizeBasketballScore(game.awayScore);
    if (
      !game.divisionId ||
      game.status !== "final" ||
      homeScore === null ||
      awayScore === null ||
      homeScore === awayScore ||
      (!isGoldFinalGame(game) && !isBronzeFinalGame(game))
    ) {
      continue;
    }
    const games = gamesByDivision.get(game.divisionId) ?? [];
    games.push(game);
    gamesByDivision.set(game.divisionId, games);
  }

  for (const [divisionId, games] of gamesByDivision.entries()) {
    const goldFinal =
      games.filter(isGoldFinalGame).sort(compareStartsAtDesc)[0] ?? null;
    if (goldFinal) {
      const winner = resultTeamFromGame(goldFinal, snapshot.teams, "winner");
      const runnerUp = resultTeamFromGame(goldFinal, snapshot.teams, "loser");
      if (winner) {
        results.push(makeResult(snapshot, divisionId, goldFinal, 1, winner));
        if (runnerUp)
          results.push(makeResult(snapshot, divisionId, goldFinal, 2, runnerUp));
      }
    }

    const bronzeFinal =
      games.filter(isExplicitBronzeFinalGame).sort(compareStartsAtDesc)[0] ??
      fallbackBronzeFinalGame(games, goldFinal);
    if (bronzeFinal) {
      const bronze = resultTeamFromGame(bronzeFinal, snapshot.teams, "winner");
      if (bronze)
        results.push(makeResult(snapshot, divisionId, bronzeFinal, 3, bronze));
    }
  }

  return results.sort(compareResults);
}

export function buildDivisionResultGroups(
  snapshot: CourtWatchSnapshot,
  options: { scope?: "watched" | "all" } = {},
): DivisionResultGroup[] {
  const scope = options.scope ?? "watched";
  const resultsByKey = new Map<string, DivisionResult>();
  const recordsByTeamId = buildTeamRecordSummaries(
    snapshot.games,
    snapshot.teams,
  );

  for (const result of deriveDivisionResultsFromGames(snapshot)) {
    resultsByKey.set(resultKey(result), result);
  }
  for (const result of snapshot.divisionResults) {
    if (isTrustedStoredResult(result)) {
      resultsByKey.set(resultKey(result), result);
    }
  }

  const storedResults = Array.from(resultsByKey.values());
  const divisionIds =
    scope === "watched"
      ? watchedDivisionIds(snapshot, storedResults)
      : registeredDivisionIds(snapshot, storedResults);
  if (scope === "watched" && divisionIds.size === 0) return [];

  const results = Array.from(resultsByKey.values())
    .filter((result) => divisionIds.has(result.divisionId))
    .map((result) => withResultRecord(result, recordsByTeamId));

  const groups = new Map<string, DivisionResultGroup>();
  for (const divisionId of divisionIds) {
    groups.set(divisionId, emptyResultGroup(snapshot, divisionId));
  }

  for (const result of results.sort(compareResults)) {
    const existing = groups.get(result.divisionId);
    if (existing) {
      if (existing.rows.length === 0 && existing.divisionName === "Division TBD") {
        existing.divisionName = result.divisionName;
        existing.gender = result.gender;
        existing.gradeLevel = result.gradeLevel;
        existing.level = result.level;
      }
      existing.rows.push(result);
      existing.sourceUrl ??= result.sourceUrl;
      existing.lastUpdatedAt = maxIso(
        existing.lastUpdatedAt,
        result.lastSeenAt,
      );
      existing.isOfficial = existing.isOfficial || result.isOfficial;
      continue;
    }
    groups.set(result.divisionId, {
      divisionId: result.divisionId,
      divisionName: result.divisionName,
      gender: result.gender,
      gradeLevel: result.gradeLevel,
      level: result.level,
      sourceUrl: result.sourceUrl,
      lastUpdatedAt: result.lastSeenAt,
      isOfficial: result.isOfficial,
      rows: [result],
    });
  }

  return withoutEmptyParentGroupsWithPoolResults(
    Array.from(groups.values()),
  ).sort((left, right) =>
    left.divisionName.localeCompare(right.divisionName, "en-US", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function withoutEmptyParentGroupsWithPoolResults(
  groups: DivisionResultGroup[],
): DivisionResultGroup[] {
  const divisionNamesWithPoolResults = new Set(
    groups
      .filter((group) => group.rows.length > 0)
      .map((group) => parentDivisionNameFromPoolGroup(group.divisionName))
      .filter((name): name is string => Boolean(name)),
  );
  if (divisionNamesWithPoolResults.size === 0) return groups;
  return groups.filter(
    (group) =>
      group.rows.length > 0 ||
      !divisionNamesWithPoolResults.has(group.divisionName),
  );
}

function parentDivisionNameFromPoolGroup(divisionName: string): string | null {
  const match = divisionName.match(/^(.*?)\s+-\s+Pool\s+.+$/i);
  return match?.[1]?.trim() || null;
}

function watchedDivisionIds(
  snapshot: CourtWatchSnapshot,
  results: DivisionResult[],
): Set<string> {
  const activeProgramIds = new Set(
    snapshot.programs
      .filter((program) => program.active)
      .map((program) => program.id),
  );
  const watchedTeamIds = new Set(
    snapshot.matches
      .filter(
        (match) =>
          match.active && activeProgramIds.has(match.programWatchlistId),
      )
      .map((match) => match.teamId),
  );
  const divisionIds = new Set(
    snapshot.teams
      .filter((team) => watchedTeamIds.has(team.id) && team.divisionId)
      .map((team) => team.divisionId as string),
  );
  for (const result of results) {
    if (result.teamId && watchedTeamIds.has(result.teamId)) {
      divisionIds.add(result.divisionId);
    }
  }
  return divisionIds;
}

function registeredDivisionIds(
  snapshot: CourtWatchSnapshot,
  results: DivisionResult[],
): Set<string> {
  const teamDivisionIds = new Set(
    snapshot.teams
      .map((team) => team.divisionId)
      .filter((divisionId): divisionId is string => Boolean(divisionId)),
  );
  for (const result of results) {
    teamDivisionIds.add(result.divisionId);
  }
  if (teamDivisionIds.size > 0) return teamDivisionIds;
  return new Set(snapshot.divisions.map((division) => division.id));
}

function emptyResultGroup(
  snapshot: Pick<CourtWatchSnapshot, "divisions" | "games" | "teams">,
  divisionId: string,
): DivisionResultGroup {
  const division = snapshot.divisions.find((item) => item.id === divisionId);
  const divisionTeam = snapshot.teams.find(
    (team) => team.divisionId === divisionId,
  );
  const divisionGames = snapshot.games.filter(
    (game) => game.divisionId === divisionId,
  );
  return {
    divisionId,
    divisionName:
      division?.name ?? divisionTeam?.divisionName ?? "Division TBD",
    gender: division?.gender ?? divisionTeam?.gender ?? null,
    gradeLevel: division?.gradeLevel ?? divisionTeam?.gradeLevel ?? null,
    level: division?.level ?? divisionTeam?.level ?? null,
    sourceUrl: sourceUrlForDivision(divisionGames),
    lastUpdatedAt: divisionGames.reduce<string | null>(
      (latest, game) => maxIso(latest, game.updatedAt),
      null,
    ),
    isOfficial: false,
    rows: [],
  };
}

function sourceUrlForDivision(games: Game[]): string | null {
  for (const game of games) {
    const sourceUrl = bracketUrlFromGame(game) ?? game.officialUrl;
    if (sourceUrl) return sourceUrl;
  }
  return null;
}

function makeResult(
  snapshot: Pick<CourtWatchSnapshot, "event" | "divisions" | "teams">,
  divisionId: string,
  game: Game,
  placement: ResultPlacement,
  team: ResultTeam,
): DivisionResult {
  const division = snapshot.divisions.find((item) => item.id === divisionId);
  const sourceUrl = bracketUrlFromGame(game) ?? game.officialUrl;
  const rawJson = {
    gameId: game.id,
    exposureGameId: game.exposureGameId,
    gameType: game.gameType,
    homeScore: sanitizeBasketballScore(game.homeScore),
    awayScore: sanitizeBasketballScore(game.awayScore),
  };
  const sourceHash = hashSource({
    placement,
    teamId: team.id,
    teamNameSnapshot: team.nameSnapshot,
    sourceUrl,
    rawJson,
  });

  return {
    id: dedupeKey([
      snapshot.event.id,
      divisionId,
      placement,
      team.id ?? team.nameSnapshot,
    ]).slice(0, 24),
    eventId: snapshot.event.id,
    divisionId,
    divisionName:
      division?.name ?? divisionNameFromGame(game) ?? "Division TBD",
    gender: division?.gender ?? null,
    gradeLevel: division?.gradeLevel ?? null,
    level: division?.level ?? null,
    teamId: team.id,
    teamNameSnapshot: team.nameSnapshot,
    teamSourceUrl: team.sourceUrl,
    placement,
    medalLabel: placementMedals[placement],
    bracketLabel: game.gameType,
    source: "bracket_final",
    sourceUrl,
    isOfficial: false,
    sourceHash,
    rawJson,
    lastSeenAt: new Date().toISOString(),
  };
}

function resultTeamFromGame(
  game: Game,
  teams: Team[],
  side: "winner" | "loser",
): ResultTeam | null {
  const homeScore = sanitizeBasketballScore(game.homeScore);
  const awayScore = sanitizeBasketballScore(game.awayScore);
  if (homeScore === null || awayScore === null || homeScore === awayScore)
    return null;
  const homeWon = homeScore > awayScore;
  const useHome = side === "winner" ? homeWon : !homeWon;
  const teamId = useHome ? game.homeTeamId : game.awayTeamId;
  const nameSnapshot =
    (useHome ? game.homeTeamNameSnapshot : game.awayTeamNameSnapshot) ??
    "Team TBD";
  if (isPlaceholderTeamName(nameSnapshot)) return null;
  const team = teamId ? teams.find((item) => item.id === teamId) : null;
  return {
    id: team?.id ?? teamId,
    name: team?.name ?? nameSnapshot,
    sourceUrl: team?.sourceUrl ?? null,
    nameSnapshot,
  };
}

function isGoldFinalGame(game: Game): boolean {
  const type = normalizeGameType(game.gameType);
  if (!type || type.includes("pool")) return false;
  if (
    [
      "semi",
      "quarter",
      "play in",
      "consolation",
      "bronze",
      "third",
      "3rd",
      "silver",
    ].some((blocked) => type.includes(blocked))
  )
    return false;
  return (
    type.includes("championship") ||
    type.includes("champion") ||
    type.includes("1st place") ||
    type.includes("first place") ||
    type.includes("final")
  );
}

function isBronzeFinalGame(game: Game): boolean {
  const type = normalizeGameType(game.gameType);
  if (!type || type.includes("pool")) return false;
  if (["semi", "quarter", "play in"].some((blocked) => type.includes(blocked)))
    return false;
  return (
    type.includes("bronze") ||
    type.includes("third") ||
    type.includes("3rd") ||
    type.includes("consolation")
  );
}

function isExplicitBronzeFinalGame(game: Game): boolean {
  const type = normalizeGameType(game.gameType);
  if (!type || type.includes("pool")) return false;
  if (["semi", "quarter", "play in"].some((blocked) => type.includes(blocked)))
    return false;
  return (
    type.includes("bronze") || type.includes("third") || type.includes("3rd")
  );
}

function fallbackBronzeFinalGame(
  games: Game[],
  goldFinal: Game | null,
): Game | null {
  if (!goldFinal) return null;
  const candidates = games
    .filter((game) => game.id !== goldFinal.id)
    .filter(isFallbackPlacementFinalGame)
    .sort(compareStartsAtDesc);
  const goldFinalistIds = new Set(
    [goldFinal.homeTeamId, goldFinal.awayTeamId].filter(Boolean),
  );
  return (
    candidates.find(
      (game) => !gameTeams(game).some((id) => goldFinalistIds.has(id)),
    ) ??
    candidates[0] ??
    null
  );
}

function isFallbackPlacementFinalGame(game: Game): boolean {
  const type = normalizeGameType(game.gameType);
  if (!type || type.includes("pool")) return false;
  if (
    ["semi", "quarter", "play in", "silver"].some((blocked) =>
      type.includes(blocked),
    )
  )
    return false;
  return (
    type.includes("championship") ||
    type.includes("champion") ||
    type.includes("final") ||
    type.includes("consolation")
  );
}

function gameTeams(game: Game): string[] {
  return [game.homeTeamId, game.awayTeamId].filter((id): id is string =>
    Boolean(id),
  );
}

function normalizeGameType(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function compareStartsAtDesc(left: Game, right: Game): number {
  return new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime();
}

function compareResults(left: DivisionResult, right: DivisionResult): number {
  return (
    left.divisionName.localeCompare(right.divisionName, "en-US", {
      numeric: true,
      sensitivity: "base",
    }) || left.placement - right.placement
  );
}

function resultKey(result: DivisionResult): string {
  return `${result.divisionId}:${result.placement}`;
}

function withResultRecord(
  result: DivisionResult,
  recordsByTeamId: Map<string, TeamRecordSummary>,
): DivisionResult {
  if (!result.teamId) return result;
  const record = recordsByTeamId.get(result.teamId);
  const storedRecord = recordFromStoredResultRaw(result.rawJson);
  return record || storedRecord
    ? { ...result, record: record ?? storedRecord ?? undefined }
    : result;
}

function recordFromStoredResultRaw(rawJson: unknown): TeamRecordSummary | null {
  if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson))
    return null;
  const raw = rawJson as Record<string, unknown>;
  const wins = nonNegativeInteger(raw.Wins);
  const losses = nonNegativeInteger(raw.Losses);
  if (wins === null && losses === null) return null;
  const totalPoints = nonNegativeInteger(raw.PointsScored) ?? 0;
  const finalGames = (wins ?? 0) + (losses ?? 0);
  return {
    wins: wins ?? 0,
    losses: losses ?? 0,
    ties: 0,
    gamesScored: finalGames,
    totalPoints,
    finalGames,
    gamesSeen: finalGames,
  };
}

function nonNegativeInteger(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.trunc(numeric);
}

function buildTeamRecordSummaries(
  games: Game[],
  teams: Team[],
): Map<string, TeamRecordSummary> {
  const records = new Map<string, TeamRecordSummary>();

  for (const team of teams) {
    records.set(team.id, team.record ? { ...team.record } : emptyRecord());
  }

  const teamsWithServerRecords = new Set(
    teams
      .filter((team) => team.record && hasTeamRecordActivity(team.record))
      .map((team) => team.id),
  );

  for (const game of games) {
    addGameRecord(records, teamsWithServerRecords, game, "home");
    addGameRecord(records, teamsWithServerRecords, game, "away");
  }

  for (const [teamId, record] of records) {
    if (!hasTeamRecordActivity(record)) records.delete(teamId);
  }

  return records;
}

function addGameRecord(
  records: Map<string, TeamRecordSummary>,
  teamsWithServerRecords: Set<string>,
  game: Game,
  side: "home" | "away",
) {
  const teamId = side === "home" ? game.homeTeamId : game.awayTeamId;
  if (!teamId || teamsWithServerRecords.has(teamId)) return;

  const teamScore = sanitizeBasketballScore(
    side === "home" ? game.homeScore : game.awayScore,
  );
  const opponentScore = sanitizeBasketballScore(
    side === "home" ? game.awayScore : game.homeScore,
  );
  if (teamScore === null) return;

  const record = records.get(teamId) ?? emptyRecord();
  record.gamesSeen += 1;
  record.gamesScored += 1;
  record.totalPoints += teamScore;

  if (game.status === "final") {
    record.finalGames += 1;
    if (opponentScore !== null) {
      if (teamScore > opponentScore) record.wins += 1;
      else if (teamScore < opponentScore) record.losses += 1;
      else record.ties += 1;
    }
  }

  records.set(teamId, record);
}

function emptyRecord(): TeamRecordSummary {
  return {
    wins: 0,
    losses: 0,
    ties: 0,
    gamesScored: 0,
    totalPoints: 0,
    finalGames: 0,
    gamesSeen: 0,
  };
}

function hasTeamRecordActivity(
  record: TeamRecordSummary | null | undefined,
): record is TeamRecordSummary {
  return Boolean(
    record &&
      (record.gamesSeen > 0 ||
        record.gamesScored > 0 ||
        record.finalGames > 0 ||
        record.wins > 0 ||
        record.losses > 0 ||
        record.ties > 0 ||
        record.totalPoints > 0),
  );
}

function isTrustedStoredResult(result: DivisionResult): boolean {
  if (isPlaceholderTeamName(result.teamNameSnapshot)) return false;
  if (result.isOfficial) return true;
  if (result.source !== "bracket_final") return true;
  if (!hasOfficialPlacementSignal(result.rawJson)) return false;
  const type = normalizeGameType(result.bracketLabel);
  if (result.placement === 3)
    return (
      type.includes("bronze") || type.includes("third") || type.includes("3rd")
    );
  if (
    [
      "semi",
      "quarter",
      "play in",
      "consolation",
      "bronze",
      "third",
      "3rd",
      "silver",
    ].some((blocked) => type.includes(blocked))
  )
    return false;
  return (
    type.includes("championship") ||
    type.includes("champion") ||
    type.includes("1st place") ||
    type.includes("first place") ||
    type.includes("final")
  );
}

function hasOfficialPlacementSignal(rawJson: unknown): boolean {
  if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson))
    return false;
  const raw = rawJson as Record<string, unknown>;
  return [
    "OfficialPlacement",
    "officialPlacement",
    "IsOfficialPlacement",
    "isOfficialPlacement",
  ].some((key) => raw[key] === true);
}

function isPlaceholderTeamName(name: string | null | undefined): boolean {
  const normalized = (name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return (
    /^(w|l)\d+(\s*\([^)]*\))?$/.test(normalized) ||
    /^(winner|loser)\s+(of\s+)?(game\s+)?\d+$/.test(normalized) ||
    /^(tbd|to be determined|bye|team tbd)$/.test(normalized)
  );
}

function maxIso(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function bracketUrlFromGame(game: Game): string | null {
  if (
    !game.rawJson ||
    typeof game.rawJson !== "object" ||
    Array.isArray(game.rawJson)
  )
    return null;
  const value = (game.rawJson as { BracketUrl?: unknown }).BracketUrl;
  return typeof value === "string" && value.startsWith("http") ? value : null;
}

function divisionNameFromGame(game: Game): string | null {
  if (
    !game.rawJson ||
    typeof game.rawJson !== "object" ||
    Array.isArray(game.rawJson)
  )
    return null;
  for (const key of ["DivisionName", "divisionName", "Division", "division"]) {
    const value = (game.rawJson as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
