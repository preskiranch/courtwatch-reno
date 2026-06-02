import { buildDashboard } from "./dashboard.js";
import { detectGameChanges } from "./change-detection.js";
import { withEffectiveGameStatuses } from "./game-status.js";
import { findProgramMatches, matchTeamToProgram } from "./matcher.js";
import {
  attachTeamRecordsToGame,
  buildTeamRecordSummaryMap,
} from "./records.js";
import type {
  CourtFinderGame,
  CourtSummary,
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
    now = new Date(),
  ) {
    const games = withEffectiveGameStatuses(snapshot.games, now);
    const records = buildTeamRecordSummaryMap(games, snapshot.teams);
    if (filters.scope === "division" && filters.division) {
      return games
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
      return games
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
    for (const game of games) {
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

export class CourtFinderService {
  listCourts(snapshot: CourtWatchSnapshot, now = new Date()): CourtSummary[] {
    const games = withEffectiveGameStatuses(snapshot.games, now);
    const records = buildTeamRecordSummaryMap(games, snapshot.teams);
    const divisionsById = new Map(
      snapshot.divisions.map((division) => [division.id, division]),
    );
    const grouped = new Map<
      string,
      {
        courtKey: string;
        courtName: string;
        venueName: string | null;
        games: CourtFinderGame[];
      }
    >();

    for (const game of games) {
      if (!game.courtName) continue;
      const courtKey = courtFinderKey(game.venueName, game.courtName);
      const existing = grouped.get(courtKey) ?? {
        courtKey,
        courtName: game.courtName,
        venueName: game.venueName,
        games: [],
      };
      existing.games.push({
        game: attachTeamRecordsToGame(game, records),
        division: game.divisionId
          ? (divisionsById.get(game.divisionId) ?? null)
          : null,
      });
      grouped.set(courtKey, existing);
    }

    const nowMs = now.getTime();
    return Array.from(grouped.values())
      .map((court) => {
        const gamesForCourt = court.games.sort(compareCourtFinderGames);
        const currentGames = gamesForCourt.filter(
          (item) => item.game.status === "playing_now",
        );
        const upNextGame =
          gamesForCourt.find((item) => {
            if (
              item.game.status === "final" ||
              item.game.status === "playing_now"
            )
              return false;
            const startsAt = Date.parse(item.game.startsAt);
            return Number.isFinite(startsAt) && startsAt >= nowMs;
          }) ?? null;
        const recentGame =
          [...gamesForCourt].reverse().find((item) => {
            const startsAt = Date.parse(item.game.startsAt);
            return Number.isFinite(startsAt) && startsAt <= nowMs;
          }) ?? null;
        return {
          ...court,
          currentGames,
          upNextGame,
          recentGame,
          games: gamesForCourt,
        };
      })
      .sort(compareCourtSummaries);
  }
}

function courtFinderKey(
  venueName: string | null | undefined,
  courtName: string,
): string {
  return `${normalizeCourtPart(venueName ?? "venue tbd")}::${normalizeCourtPart(courtName)}`;
}

function normalizeCourtPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compareCourtFinderGames(
  left: CourtFinderGame,
  right: CourtFinderGame,
) {
  return Date.parse(left.game.startsAt) - Date.parse(right.game.startsAt);
}

function compareCourtSummaries(left: CourtSummary, right: CourtSummary) {
  return (
    String(left.venueName ?? "").localeCompare(
      String(right.venueName ?? ""),
      "en-US",
      {
        numeric: true,
        sensitivity: "base",
      },
    ) ||
    left.courtName.localeCompare(right.courtName, "en-US", {
      numeric: true,
      sensitivity: "base",
    })
  );
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
