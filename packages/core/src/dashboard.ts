import type {
  CourtWatchSnapshot,
  DashboardResponse,
  DivisionResult,
  Game,
  GameChangeEvent,
  ProgramSummary,
  Team,
} from "./types.js";
import { DISCLAIMER } from "./types.js";
import {
  isCurrentOrFutureGame,
  withEffectiveGameStatuses,
} from "./game-status.js";
import {
  attachTeamRecordsToGame,
  buildTeamRecordSummaryMap,
} from "./records.js";
import { buildTeamScoringLeaders } from "./scoring-leaders.js";

function compareStartsAt(left: Game, right: Game): number {
  return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
}

export function teamGames(team: Team, games: Game[]): Game[] {
  return games.filter(
    (game) => game.homeTeamId === team.id || game.awayTeamId === team.id,
  );
}

export function nextGameForTeam(
  team: Team,
  games: Game[],
  now = new Date(),
): Game | null {
  return (
    teamGames(team, games)
      .filter((game) => isCurrentOrFutureGame(game, now))
      .sort(compareStartsAt)[0] ?? null
  );
}

export function lastResultForTeam(
  team: Team,
  games: Game[],
  now = new Date(),
): Game | null {
  return (
    teamGames(team, games)
      .filter((game) => game.status === "final")
      .sort((left, right) => compareStartsAt(right, left))[0] ?? null
  );
}

export function buildProgramSummaries(
  snapshot: CourtWatchSnapshot,
  now = new Date(),
): ProgramSummary[] {
  const games = withEffectiveGameStatuses(snapshot.games, now);
  const records = buildTeamRecordSummaryMap(games, snapshot.teams);

  return snapshot.programs
    .filter((program) => program.active)
    .map((program) => {
      const aliases = snapshot.aliases.filter(
        (alias) => alias.programWatchlistId === program.id,
      );
      const matches = snapshot.matches.filter(
        (match) => match.programWatchlistId === program.id && match.active,
      );
      const teams = matches
        .map((match) => {
          const team = snapshot.teams.find((item) => item.id === match.teamId);
          if (!team) return null;
          const nextGame = nextGameForTeam(team, games, now);
          const lastResult = lastResultForTeam(team, games, now);
          return {
            ...team,
            record: records.get(team.id),
            matchType: match.matchType,
            matchConfidence: match.matchConfidence,
            nextGame: nextGame
              ? attachTeamRecordsToGame(nextGame, records)
              : null,
            lastResult: lastResult
              ? attachTeamRecordsToGame(lastResult, records)
              : null,
            liveStatus:
              nextGame?.status ?? lastResult?.status ?? "awaiting_bracket",
          };
        })
        .filter((team): team is NonNullable<typeof team> => Boolean(team))
        .sort(
          (left, right) =>
            (left.divisionName ?? "").localeCompare(right.divisionName ?? "") ||
            left.name.localeCompare(right.name),
        );

      const programGameIds = new Set(
        teams.flatMap((team) =>
          teamGames(team, games).map((game) => game.id),
        ),
      );
      const programTeamIds = new Set(teams.map((team) => team.id));
      const programGames = games.filter((game) => programGameIds.has(game.id));
      const nextGame =
        programGames
          .filter((game) => isCurrentOrFutureGame(game, now))
          .sort(compareStartsAt)[0] ?? null;
      const latestResult =
        programGames
          .filter((game) => game.status === "final")
          .sort((left, right) => compareStartsAt(right, left))[0] ?? null;
      const alertsCount = mergeAlertEvents(
        watchedAlertEvents(
          snapshot.changeEvents,
          programTeamIds,
          programGameIds,
          new Set([program.id]),
        ),
        watchedFinalPlacementAlertEvents(snapshot, programTeamIds),
      ).length;

      return {
        program,
        aliases,
        teams,
        nextGame: nextGame ? attachTeamRecordsToGame(nextGame, records) : null,
        latestResult: latestResult
          ? attachTeamRecordsToGame(latestResult, records)
          : null,
        alertsCount,
        zeroStateMessage:
          teams.length === 0
            ? `${program.programName}: no teams selected yet. Search registered teams and tap Follow.`
            : undefined,
      };
    });
}

export function buildDashboard(
  snapshot: CourtWatchSnapshot,
  now = new Date(),
  options: { includeEvents?: boolean; includePointsLeaders?: boolean } = {},
): DashboardResponse {
  const includeEvents = options.includeEvents ?? true;
  const includePointsLeaders = options.includePointsLeaders ?? true;
  const effectiveSnapshot = {
    ...snapshot,
    games: withEffectiveGameStatuses(snapshot.games, now),
  };
  const records = buildTeamRecordSummaryMap(
    effectiveSnapshot.games,
    effectiveSnapshot.teams,
  );
  const programs = buildProgramSummaries(effectiveSnapshot, now);
  const watchedTeamIds = new Set(
    programs.flatMap((program) => program.teams.map((team) => team.id)),
  );
  const watchedGames = effectiveSnapshot.games.filter(
    (game) =>
      watchedTeamIds.has(game.homeTeamId ?? "") ||
      watchedTeamIds.has(game.awayTeamId ?? ""),
  );
  const watchedGameIds = new Set(watchedGames.map((game) => game.id));
  const activeProgramIds = new Set(
    programs.map((program) => program.program.id),
  );
  const nextGame =
    watchedGames
      .filter((game) => isCurrentOrFutureGame(game, now))
      .sort(compareStartsAt)[0] ?? null;
  const lastRun =
    [...snapshot.syncRuns].sort(
      (left, right) =>
        new Date(right.startedAt).getTime() -
        new Date(left.startedAt).getTime(),
    )[0] ?? null;
  const watchedAlerts = mergeAlertEvents(
    watchedAlertEvents(
      snapshot.changeEvents,
      watchedTeamIds,
      watchedGameIds,
      activeProgramIds,
    ),
    watchedFinalPlacementAlertEvents(effectiveSnapshot, watchedTeamIds),
  );

  return {
    event: snapshot.event,
    events: includeEvents ? snapshot.events : [],
    nextGame: nextGame ? attachTeamRecordsToGame(nextGame, records) : null,
    programs,
    pointsLeaders: includePointsLeaders
      ? buildTeamScoringLeaders(effectiveSnapshot.games, effectiveSnapshot.teams, {
          includeUnscoredTeams: true,
        })
      : [],
    alerts: watchedAlerts.slice(0, 20),
    lastUpdated: snapshot.event.lastSyncedAt,
    sourceStatus: {
      source: lastRun?.source ?? "mock",
      status: lastRun?.status ?? "success",
      lastSyncAt: lastRun?.completedAt ?? snapshot.event.lastSyncedAt,
      message:
        lastRun?.status === "failed"
          ? (lastRun.errorMessage ??
            "Last sync failed; showing saved schedule.")
          : snapshot.games.length === 0
            ? "Team data is current. No official game or score feed is available yet, so no results are shown."
            : "Schedule data is current from the latest successful sync.",
    },
    disclaimer: DISCLAIMER,
  };
}

export function watchedAlertsForSnapshot(
  snapshot: CourtWatchSnapshot,
  watchedTeamIds: Set<string>,
  watchedGameIds: Set<string>,
  activeProgramIds: Set<string>,
): GameChangeEvent[] {
  return mergeAlertEvents(
    watchedAlertEvents(
      snapshot.changeEvents,
      watchedTeamIds,
      watchedGameIds,
      activeProgramIds,
    ),
    watchedFinalPlacementAlertEvents(snapshot, watchedTeamIds),
  );
}

export function watchedAlertEvents(
  changeEvents: GameChangeEvent[],
  watchedTeamIds: Set<string>,
  watchedGameIds: Set<string>,
  activeProgramIds: Set<string>,
): GameChangeEvent[] {
  return changeEvents.filter((event) => {
    if (
      event.affectedProgramWatchlistId &&
      !activeProgramIds.has(event.affectedProgramWatchlistId)
    )
      return false;
    if (event.affectedTeamId && watchedTeamIds.has(event.affectedTeamId))
      return true;
    if (event.gameId && watchedGameIds.has(event.gameId)) return true;
    return false;
  });
}

export function watchedFinalPlacementAlertEvents(
  snapshot: CourtWatchSnapshot,
  watchedTeamIds: Set<string>,
): GameChangeEvent[] {
  if (watchedTeamIds.size === 0 || snapshot.divisionResults.length === 0)
    return [];

  const watchedTeams = snapshot.teams.filter((team) =>
    watchedTeamIds.has(team.id),
  );
  return snapshot.divisionResults.flatMap((result) => {
    const team = matchedWatchedTeamForResult(result, watchedTeams);
    if (!team) return [];
    return [finalPlacementAlertForResult(result, team)];
  });
}

function mergeAlertEvents(...groups: GameChangeEvent[][]): GameChangeEvent[] {
  const alerts = new Map<string, GameChangeEvent>();
  for (const group of groups) {
    for (const alert of group) {
      const key = alert.dedupeKey || alert.id;
      if (!alerts.has(key)) alerts.set(key, alert);
    }
  }
  return Array.from(alerts.values()).sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function matchedWatchedTeamForResult(
  result: Pick<
    DivisionResult,
    "divisionId" | "teamId" | "teamNameSnapshot" | "teamSourceUrl"
  >,
  watchedTeams: Team[],
): Team | null {
  if (result.teamId) {
    const team = watchedTeams.find((item) => item.id === result.teamId);
    if (team) return team;
  }
  const sourceUrl = normalizeUrl(result.teamSourceUrl);
  if (sourceUrl) {
    const team = watchedTeams.find(
      (item) => normalizeUrl(item.sourceUrl) === sourceUrl,
    );
    if (team) return team;
  }
  const resultName = normalizeTeamMatchName(result.teamNameSnapshot);
  return (
    watchedTeams.find(
      (team) =>
        team.divisionId === result.divisionId &&
        normalizeTeamMatchName(team.name) === resultName,
    ) ?? null
  );
}

function finalPlacementAlertForResult(
  result: DivisionResult,
  team: Team,
): GameChangeEvent {
  const placementLabel = resultPlacementAlertLabel(result);
  return {
    id: `result-alert-${result.id}`,
    gameId: null,
    affectedTeamId: team.id,
    affectedProgramWatchlistId: null,
    eventType: "final_placement",
    previousValue: null,
    newValue: {
      teamName: result.teamNameSnapshot,
      divisionName: result.divisionName,
      placement: result.placement,
      medalLabel: result.medalLabel,
      placementLabel,
      sourceUrl: result.sourceUrl,
      isOfficial: result.isOfficial,
    },
    createdAt: result.lastSeenAt,
    notificationSent: true,
    dedupeKey: [
      "final-placement",
      result.eventId,
      result.divisionId,
      String(result.placement),
      result.teamId ?? normalizeTeamMatchName(result.teamNameSnapshot),
    ].join(":"),
  };
}

function resultPlacementAlertLabel(result: Pick<DivisionResult, "placement">) {
  if (result.placement === 1) return "Champion / 1st / Gold";
  if (result.placement === 2) return "2nd / Silver";
  return "3rd / Bronze";
}

function normalizeTeamMatchName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\b(splash city)\s*(\d+u)\b/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}
