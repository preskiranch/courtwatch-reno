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
      if (winner)
        results.push(makeResult(snapshot, divisionId, goldFinal, 1, winner));
      if (runnerUp)
        results.push(makeResult(snapshot, divisionId, goldFinal, 2, runnerUp));
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

  for (const result of snapshot.divisionResults) {
    if (isTrustedStoredResult(result)) {
      resultsByKey.set(resultKey(result), result);
    }
  }
  for (const result of deriveDivisionResultsFromGames(snapshot)) {
    resultsByKey.set(resultKey(result), result);
  }

  const divisionIds =
    scope === "watched"
      ? watchedDivisionIds(snapshot)
      : new Set(snapshot.divisions.map((division) => division.id));
  if (scope === "watched" && divisionIds.size === 0) return [];

  const results = Array.from(resultsByKey.values()).filter((result) =>
    divisionIds.has(result.divisionId),
  );

  const groups = new Map<string, DivisionResultGroup>();
  for (const division of snapshot.divisions) {
    if (!divisionIds.has(division.id)) continue;
    groups.set(division.id, emptyResultGroup(snapshot, division.id));
  }

  for (const result of results.sort(compareResults)) {
    const existing = groups.get(result.divisionId);
    if (existing) {
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

  return Array.from(groups.values()).sort((left, right) =>
    left.divisionName.localeCompare(right.divisionName, "en-US", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function watchedDivisionIds(snapshot: CourtWatchSnapshot): Set<string> {
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
  return new Set(
    snapshot.teams
      .filter((team) => watchedTeamIds.has(team.id) && team.divisionId)
      .map((team) => team.divisionId as string),
  );
}

function emptyResultGroup(
  snapshot: Pick<CourtWatchSnapshot, "divisions" | "games">,
  divisionId: string,
): DivisionResultGroup {
  const division = snapshot.divisions.find((item) => item.id === divisionId);
  const divisionGames = snapshot.games.filter(
    (game) => game.divisionId === divisionId,
  );
  return {
    divisionId,
    divisionName: division?.name ?? "Division TBD",
    gender: division?.gender ?? null,
    gradeLevel: division?.gradeLevel ?? null,
    level: division?.level ?? null,
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

function isTrustedStoredResult(result: DivisionResult): boolean {
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
