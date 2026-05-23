import type { CourtWatchSnapshot, DashboardResponse, Game, GameChangeEvent, ProgramSummary, Team } from "./types.js";
import { DISCLAIMER } from "./types.js";

function compareStartsAt(left: Game, right: Game): number {
  return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
}

export function teamGames(team: Team, games: Game[]): Game[] {
  return games.filter((game) => game.homeTeamId === team.id || game.awayTeamId === team.id);
}

export function nextGameForTeam(team: Team, games: Game[], now = new Date()): Game | null {
  return teamGames(team, games)
    .filter((game) => new Date(game.startsAt).getTime() >= now.getTime() && game.status !== "final")
    .sort(compareStartsAt)[0] ?? null;
}

export function lastResultForTeam(team: Team, games: Game[], now = new Date()): Game | null {
  return teamGames(team, games)
    .filter((game) => game.status === "final" || new Date(game.startsAt).getTime() < now.getTime())
    .sort((left, right) => compareStartsAt(right, left))[0] ?? null;
}

export function buildProgramSummaries(snapshot: CourtWatchSnapshot, now = new Date()): ProgramSummary[] {
  return snapshot.programs.filter((program) => program.active).map((program) => {
    const aliases = snapshot.aliases.filter((alias) => alias.programWatchlistId === program.id);
    const matches = snapshot.matches.filter((match) => match.programWatchlistId === program.id && match.active);
    const teams = matches
      .map((match) => {
        const team = snapshot.teams.find((item) => item.id === match.teamId);
        if (!team) return null;
        const nextGame = nextGameForTeam(team, snapshot.games, now);
        const lastResult = lastResultForTeam(team, snapshot.games, now);
        return {
          ...team,
          matchType: match.matchType,
          matchConfidence: match.matchConfidence,
          nextGame,
          lastResult,
          liveStatus: nextGame?.status ?? lastResult?.status ?? "awaiting_bracket"
        };
      })
      .filter((team): team is NonNullable<typeof team> => Boolean(team))
      .sort((left, right) => (left.divisionName ?? "").localeCompare(right.divisionName ?? "") || left.name.localeCompare(right.name));

    const programGameIds = new Set(teams.flatMap((team) => teamGames(team, snapshot.games).map((game) => game.id)));
    const programGames = snapshot.games.filter((game) => programGameIds.has(game.id));
    const nextGame = programGames
      .filter((game) => new Date(game.startsAt).getTime() >= now.getTime() && game.status !== "final")
      .sort(compareStartsAt)[0] ?? null;
    const latestResult = programGames
      .filter((game) => game.status === "final")
      .sort((left, right) => compareStartsAt(right, left))[0] ?? null;
    const alertsCount = snapshot.changeEvents.filter((event) => event.affectedProgramWatchlistId === program.id || (event.gameId && programGameIds.has(event.gameId))).length;

    return {
      program,
      aliases,
      teams,
      nextGame,
      latestResult,
      alertsCount,
      zeroStateMessage:
        teams.length === 0
          ? `${program.programName}: no teams selected yet. Search registered teams or player names and tap Follow.`
          : undefined
    };
  });
}

export function buildDashboard(snapshot: CourtWatchSnapshot, now = new Date()): DashboardResponse {
  const programs = buildProgramSummaries(snapshot, now);
  const watchedTeamIds = new Set(programs.flatMap((program) => program.teams.map((team) => team.id)));
  const watchedGames = snapshot.games.filter((game) => watchedTeamIds.has(game.homeTeamId ?? "") || watchedTeamIds.has(game.awayTeamId ?? ""));
  const watchedGameIds = new Set(watchedGames.map((game) => game.id));
  const activeProgramIds = new Set(programs.map((program) => program.program.id));
  const nextGame = watchedGames
    .filter((game) => new Date(game.startsAt).getTime() >= now.getTime() && game.status !== "final")
    .sort(compareStartsAt)[0] ?? null;
  const lastRun = [...snapshot.syncRuns].sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0] ?? null;
  const watchedAlerts = watchedAlertEvents(snapshot.changeEvents, watchedTeamIds, watchedGameIds, activeProgramIds);

  return {
    event: snapshot.event,
    nextGame,
    programs,
    alerts: watchedAlerts.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).slice(0, 20),
    lastUpdated: snapshot.event.lastSyncedAt,
    sourceStatus: {
      source: lastRun?.source ?? "mock",
      status: lastRun?.status ?? "success",
      lastSyncAt: lastRun?.completedAt ?? snapshot.event.lastSyncedAt,
      message:
        lastRun?.status === "failed"
          ? lastRun.errorMessage ?? "Last sync failed; showing saved schedule."
          : lastRun && lastRun.gamesCount === 0
            ? "Team data is current. No official game or score feed is available yet, so no results are shown."
            : "Schedule data is current from the latest successful sync."
    },
    disclaimer: DISCLAIMER
  };
}

export function watchedAlertEvents(changeEvents: GameChangeEvent[], watchedTeamIds: Set<string>, watchedGameIds: Set<string>, activeProgramIds: Set<string>): GameChangeEvent[] {
  return changeEvents.filter((event) => {
    if (event.affectedProgramWatchlistId && !activeProgramIds.has(event.affectedProgramWatchlistId)) return false;
    if (event.affectedTeamId && watchedTeamIds.has(event.affectedTeamId)) return true;
    if (event.gameId && watchedGameIds.has(event.gameId)) return true;
    return false;
  });
}
