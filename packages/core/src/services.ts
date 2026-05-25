import { buildDashboard } from "./dashboard.js";
import { detectGameChanges } from "./change-detection.js";
import { findProgramMatches, matchTeamToProgram } from "./matcher.js";
import {
  attachTeamRecordsToGame,
  buildTeamRecordSummaryMap,
} from "./records.js";
import type {
  CourtWatchSnapshot,
  Game,
  ProgramAlias,
  ProgramWatchlist,
  Team,
} from "./types.js";

export class ProgramMatcherService {
  match(team: Team, program: ProgramWatchlist, aliases: ProgramAlias[]) {
    return matchTeamToProgram(team, program, aliases);
  }
}

export class TeamDiscoveryService {
  discover(snapshot: CourtWatchSnapshot) {
    return findProgramMatches(
      snapshot.teams,
      snapshot.programs,
      snapshot.aliases,
    );
  }
}

export class ChangeDetectionService {
  detect(previous: Game | null, next: Game) {
    return detectGameChanges(previous, next);
  }
}

export class DashboardService {
  build(snapshot: CourtWatchSnapshot, now = new Date()) {
    return buildDashboard(snapshot, now);
  }
}

export class ScheduleService {
  listWatchedGames(
    snapshot: CourtWatchSnapshot,
    filters: {
      programId?: string;
      status?: string;
      court?: string;
      division?: string;
      scope?: string;
    } = {},
  ) {
    const records = buildTeamRecordSummaryMap(snapshot.games, snapshot.teams);
    if (filters.scope === "division" && filters.division) {
      return snapshot.games
        .filter((game) => game.divisionId === filters.division)
        .filter((game) => !filters.status || game.status === filters.status)
        .filter((game) => !filters.court || game.courtName === filters.court)
        .sort(
          (left, right) =>
            new Date(left.startsAt).getTime() -
            new Date(right.startsAt).getTime(),
        )
        .map((game) => attachTeamRecordsToGame(game, records));
    }

    if (filters.scope === "all") {
      return snapshot.games
        .filter((game) => !filters.status || game.status === filters.status)
        .filter((game) => !filters.court || game.courtName === filters.court)
        .filter(
          (game) => !filters.division || game.divisionId === filters.division,
        )
        .sort(
          (left, right) =>
            new Date(left.startsAt).getTime() -
            new Date(right.startsAt).getTime(),
        )
        .map((game) => attachTeamRecordsToGame(game, records));
    }

    const activeProgramIds = new Set(
      snapshot.programs
        .filter((program) => program.active)
        .map((program) => program.id),
    );
    const watchedTeamIds = new Set(
      snapshot.matches
        .filter(
          (match) =>
            match.active &&
            activeProgramIds.has(match.programWatchlistId) &&
            (!filters.programId ||
              match.programWatchlistId === filters.programId),
        )
        .map((match) => match.teamId),
    );

    const gamesById = new Map<string, Game>();
    for (const game of snapshot.games) {
      if (
        !watchedTeamIds.has(game.homeTeamId ?? "") &&
        !watchedTeamIds.has(game.awayTeamId ?? "")
      )
        continue;
      if (filters.status && game.status !== filters.status) continue;
      if (filters.court && game.courtName !== filters.court) continue;
      if (filters.division && game.divisionId !== filters.division) continue;
      gamesById.set(game.id, game);
    }

    return Array.from(gamesById.values())
      .sort(
        (left, right) =>
          new Date(left.startsAt).getTime() -
          new Date(right.startsAt).getTime(),
      )
      .map((game) => attachTeamRecordsToGame(game, records));
  }
}

export class RenderHealthCheckService {
  check(status: {
    dbConfigured: boolean;
    sourceConfigured: boolean;
    lastSyncAt: string | null;
  }) {
    return {
      ok: true,
      service: "courtwatch-reno-api",
      dbConfigured: status.dbConfigured,
      exposureApiConfigured: status.sourceConfigured,
      lastSyncAt: status.lastSyncAt,
      time: new Date().toISOString(),
    };
  }
}

export class TournamentSyncService {
  constructor(
    private readonly syncRunner: () => Promise<{
      status: string;
      teamsCount: number;
      gamesCount: number;
      changesDetected: number;
    }>,
  ) {}

  async syncOnce() {
    return this.syncRunner();
  }
}
