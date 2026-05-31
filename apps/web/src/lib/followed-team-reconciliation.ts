import {
  attachTeamRecordsToGame,
  lastResultForTeam,
  nextGameForTeam,
  withEffectiveGameStatuses,
  type DashboardResponse,
  type Game,
  type ProgramSummary,
  type Team,
  type TeamRecordSummary,
} from "@courtwatch/core";

export function dashboardWithRegisteredFollows(
  dashboard: DashboardResponse,
  registeredTeams: Team[],
  games: Game[],
  records: Map<string, TeamRecordSummary>,
): DashboardResponse {
  const primaryProgram = programWithRegisteredFollows(
    dashboard.programs[0],
    registeredTeams,
    games,
    records,
  );
  if (!primaryProgram || primaryProgram === dashboard.programs[0])
    return dashboard;

  return {
    ...dashboard,
    nextGame: primaryProgram.nextGame,
    programs: [primaryProgram, ...dashboard.programs.slice(1)],
  };
}

export function programWithRegisteredFollows(
  program: ProgramSummary | undefined,
  registeredTeams: Team[],
  games: Game[],
  records: Map<string, TeamRecordSummary>,
): ProgramSummary | undefined {
  if (!program) return program;
  const followedTeams = registeredTeams.filter((team) => team.isFollowed);
  if (followedTeams.length === 0) return program;

  const currentTeamsById = new Map(
    program.teams.map((team) => [team.id, team]),
  );
  const effectiveGames = withEffectiveGameStatuses(games);
  const now = new Date();
  const teams = followedTeams
    .map((team) =>
      enrichFollowedTeam(
        mergeFollowedTeam(currentTeamsById.get(team.id), team),
        effectiveGames,
        records,
        now,
      ),
    )
    .sort(
      (left, right) =>
        (left.divisionName ?? "").localeCompare(
          right.divisionName ?? "",
          "en-US",
          { numeric: true, sensitivity: "base" },
        ) ||
        left.name.localeCompare(right.name, "en-US", {
          numeric: true,
          sensitivity: "base",
        }),
    );

  const nextGame =
    teams
      .map((team) => team.nextGame)
      .filter((game): game is Game => Boolean(game))
      .sort(
        (left, right) =>
          new Date(left.startsAt).getTime() -
          new Date(right.startsAt).getTime(),
      )[0] ?? null;
  const latestResult =
    teams
      .map((team) => team.lastResult)
      .filter((game): game is Game => Boolean(game))
      .sort(
        (left, right) =>
          new Date(right.startsAt).getTime() -
          new Date(left.startsAt).getTime(),
      )[0] ?? null;

  return {
    ...program,
    teams,
    nextGame: nextGame ? attachTeamRecordsToGame(nextGame, records) : null,
    latestResult: latestResult
      ? attachTeamRecordsToGame(latestResult, records)
      : null,
    zeroStateMessage: undefined,
  };
}

function enrichFollowedTeam(
  team: Team | ProgramSummary["teams"][number],
  games: Game[],
  records: Map<string, TeamRecordSummary>,
  now: Date,
): ProgramSummary["teams"][number] {
  const nextGame = nextGameForTeam(team, games, now);
  const lastResult = lastResultForTeam(team, games, now);
  const existing =
    "matchType" in team
      ? team
      : {
          ...team,
          matchType: "manual" as const,
          matchConfidence: 1,
          nextGame: null,
          lastResult: null,
          liveStatus: "awaiting_bracket" as const,
        };

  return {
    ...existing,
    record: activeRecord(records.get(team.id), team.record),
    matchType: existing.matchType,
    matchConfidence: existing.matchConfidence,
    nextGame: nextGame
      ? attachTeamRecordsToGame(nextGame, records)
      : existing.nextGame,
    lastResult: lastResult
      ? attachTeamRecordsToGame(lastResult, records)
      : existing.lastResult,
    liveStatus:
      nextGame?.status ??
      lastResult?.status ??
      existing.nextGame?.status ??
      existing.lastResult?.status ??
      existing.liveStatus,
  };
}

function mergeFollowedTeam(
  current: ProgramSummary["teams"][number] | undefined,
  fresh: Team,
): Team | ProgramSummary["teams"][number] {
  if (!current) return fresh;
  return {
    ...current,
    ...fresh,
    matchType: current.matchType,
    matchConfidence: current.matchConfidence,
  };
}

function activeRecord(
  primary: TeamRecordSummary | undefined,
  fallback: TeamRecordSummary | undefined,
): TeamRecordSummary | undefined {
  if (hasRecordActivity(primary)) return primary;
  if (hasRecordActivity(fallback)) return fallback;
  return primary ?? fallback;
}

function hasRecordActivity(record: TeamRecordSummary | undefined): boolean {
  return Boolean(
    record &&
    (record.gamesSeen > 0 ||
      record.gamesScored > 0 ||
      record.finalGames > 0 ||
      record.wins > 0 ||
      record.losses > 0 ||
      record.ties > 0),
  );
}
