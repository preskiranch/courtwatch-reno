import type { PrismaClient } from "@courtwatch/db";
import {
  ChangeDetectionService,
  DashboardService,
  ExposureClient,
  PublicExposurePageClient,
  RENO_TIMEZONE,
  ScheduleService,
  TeamDiscoveryService,
  buildDashboard,
  detectGameChanges,
  extractDivisionMeta,
  findProgramMatches,
  hashSource,
  normalizeName,
  normalizeProgramName,
  seedAliases,
  seedChangeEvents,
  seedDivisions,
  seedEvent,
  seedGames,
  seedPrograms,
  seedSnapshot,
  seedTeams
} from "@courtwatch/core";
import type {
  CourtWatchSnapshot,
  Division,
  Game,
  GameChangeEvent,
  MatchType,
  ProgramAlias,
  ProgramTeamMatch,
  ProgramWatchlist,
  Team
} from "@courtwatch/core";
import { fromZonedTime } from "date-fns-tz";
import { config, isExposureConfigured } from "./config.js";

export interface CourtWatchStore {
  snapshot(): Promise<CourtWatchSnapshot>;
  dashboard(): Promise<ReturnType<typeof buildDashboard>>;
  program(programId: string): Promise<ReturnType<DashboardService["build"]>["programs"][number] | null>;
  games(filters: Record<string, string | undefined>): Promise<Game[]>;
  game(gameId: string): Promise<(Game & { changeHistory: GameChangeEvent[] }) | null>;
  teams(search?: string): Promise<Team[]>;
  team(teamId: string): Promise<Team | null>;
  alerts(): Promise<GameChangeEvent[]>;
  addAlias(programId: string, alias: string): Promise<ProgramAlias>;
  deleteAlias(programId: string, aliasId: string): Promise<void>;
  syncNow(): Promise<{ status: string; source: string; teamsCount: number; gamesCount: number; changesDetected: number }>;
}

export class MockStore implements CourtWatchStore {
  private data: CourtWatchSnapshot = structuredClone(seedSnapshot);

  async snapshot(): Promise<CourtWatchSnapshot> {
    return structuredClone(this.data);
  }

  async dashboard() {
    return buildDashboard(await this.snapshot());
  }

  async program(programId: string) {
    return (await this.dashboard()).programs.find((program) => program.program.id === programId) ?? null;
  }

  async games(filters: Record<string, string | undefined>) {
    const schedule = new ScheduleService().listWatchedGames(await this.snapshot(), {
      programId: filters.programId,
      status: filters.status,
      court: filters.court,
      division: filters.division
    });
    return schedule;
  }

  async game(gameId: string) {
    const snapshot = await this.snapshot();
    const game = snapshot.games.find((item) => item.id === gameId);
    return game ? { ...game, changeHistory: snapshot.changeEvents.filter((event) => event.gameId === gameId) } : null;
  }

  async teams(search?: string) {
    const normalized = normalizeName(search);
    const snapshot = await this.snapshot();
    return normalized ? snapshot.teams.filter((team) => team.normalizedName.includes(normalized)) : snapshot.teams;
  }

  async team(teamId: string) {
    return (await this.snapshot()).teams.find((team) => team.id === teamId) ?? null;
  }

  async alerts() {
    return (await this.snapshot()).changeEvents.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  async addAlias(programId: string, aliasValue: string) {
    const alias: ProgramAlias = {
      id: `alias-${Date.now()}`,
      programWatchlistId: programId,
      alias: aliasValue,
      normalizedAlias: normalizeProgramName(aliasValue),
      createdAt: new Date().toISOString()
    };
    this.data.aliases.push(alias);
    await this.syncNow();
    return alias;
  }

  async deleteAlias(programId: string, aliasId: string) {
    this.data.aliases = this.data.aliases.filter((alias) => !(alias.programWatchlistId === programId && alias.id === aliasId));
  }

  async syncNow() {
    const run = {
      id: `sync-${Date.now()}`,
      eventId: this.data.event.id,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: "success" as const,
      source: "mock" as const,
      teamsCount: this.data.teams.length,
      gamesCount: this.data.games.length,
      changesDetected: 0,
      errorMessage: null
    };
    this.data.event.lastSyncedAt = run.completedAt;
    this.data.syncRuns.unshift(run);
    return { status: run.status, source: run.source, teamsCount: run.teamsCount, gamesCount: run.gamesCount, changesDetected: run.changesDetected };
  }
}

export class PrismaStore implements CourtWatchStore {
  constructor(private readonly prisma: PrismaClient) {}

  async snapshot(): Promise<CourtWatchSnapshot> {
    const event = await this.prisma.event.findUnique({ where: { exposureEventId: config.EXPOSURE_EVENT_ID } });
    if (!event) return structuredClone(seedSnapshot);

    const [divisions, teams, programs, aliases, matches, games, changeEvents, syncRuns] = await Promise.all([
      this.prisma.division.findMany({ where: { eventId: event.id } }),
      this.prisma.team.findMany({ where: { eventId: event.id }, include: { division: true } }),
      this.prisma.programWatchlist.findMany({ where: { active: true } }),
      this.prisma.programAlias.findMany(),
      this.prisma.programTeamMatch.findMany({ where: { active: true } }),
      this.prisma.game.findMany({ where: { eventId: event.id }, orderBy: { startsAt: "asc" } }),
      this.prisma.gameChangeEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.syncRun.findMany({ where: { eventId: event.id }, orderBy: { startedAt: "desc" }, take: 20 })
    ]);

    return {
      event: {
        id: event.id,
        exposureEventId: event.exposureEventId,
        name: event.name,
        organizer: event.organizer,
        startDate: event.startDate.toISOString().slice(0, 10),
        endDate: event.endDate.toISOString().slice(0, 10),
        location: event.location,
        officialUrl: event.officialUrl,
        lastSyncedAt: event.lastSyncedAt?.toISOString() ?? null
      },
      divisions: divisions.map((division) => ({
        id: division.id,
        eventId: division.eventId,
        exposureDivisionId: division.exposureDivisionId,
        name: division.name,
        gender: division.gender,
        gradeLevel: division.gradeLevel,
        level: division.level,
        rawJson: division.rawJson
      })),
      teams: teams.map((team) => ({
        id: team.id,
        eventId: team.eventId,
        divisionId: team.divisionId,
        exposureTeamId: team.exposureTeamId,
        name: team.name,
        normalizedName: team.normalizedName,
        clubName: team.clubName,
        normalizedClubName: team.normalizedClubName,
        coachName: team.coachName,
        sourceUrl: team.sourceUrl,
        divisionName: team.division?.name ?? null,
        gender: team.division?.gender ?? null,
        gradeLevel: team.division?.gradeLevel ?? null,
        level: team.division?.level ?? null,
        rawJson: team.rawJson,
        lastSeenAt: team.lastSeenAt.toISOString()
      })),
      programs: programs.map((program) => ({
        id: program.id,
        userId: program.userId,
        programName: program.programName,
        normalizedProgramName: program.normalizedProgramName,
        active: program.active,
        createdAt: program.createdAt.toISOString()
      })),
      aliases: aliases.map((alias) => ({
        id: alias.id,
        programWatchlistId: alias.programWatchlistId,
        alias: alias.alias,
        normalizedAlias: alias.normalizedAlias,
        createdAt: alias.createdAt.toISOString()
      })),
      matches: matches.map((match) => ({
        id: match.id,
        programWatchlistId: match.programWatchlistId,
        teamId: match.teamId,
        matchType: match.matchType as MatchType,
        matchConfidence: Number(match.matchConfidence),
        active: match.active,
        createdAt: match.createdAt.toISOString()
      })),
      games: games.map((game) => ({
        id: game.id,
        eventId: game.eventId,
        divisionId: game.divisionId,
        exposureGameId: game.exposureGameId,
        gameNumber: game.gameNumber,
        gameType: game.gameType,
        scheduledDate: game.scheduledDate.toISOString().slice(0, 10),
        scheduledTime: game.scheduledTime,
        startsAt: game.startsAt.toISOString(),
        timezone: game.timezone,
        venueName: game.venueName,
        courtName: game.courtName,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homeTeamNameSnapshot: game.homeTeamNameSnapshot,
        awayTeamNameSnapshot: game.awayTeamNameSnapshot,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        status: game.status as Game["status"],
        officialUrl: game.officialUrl,
        streamingUrl: game.streamingUrl,
        updatedAt: game.updatedAt.toISOString(),
        sourceHash: game.sourceHash,
        rawJson: game.rawJson
      })),
      changeEvents: changeEvents.map(toCoreChange),
      syncRuns: syncRuns.map((run) => ({
        id: run.id,
        eventId: run.eventId,
        startedAt: run.startedAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
        status: run.status as "success" | "failed" | "running",
        source: run.source as "exposure_api" | "public_page" | "mock",
        teamsCount: run.teamsCount,
        gamesCount: run.gamesCount,
        changesDetected: run.changesDetected,
        errorMessage: run.errorMessage
      }))
    };
  }

  async dashboard() {
    return buildDashboard(await this.snapshot());
  }

  async program(programId: string) {
    return (await this.dashboard()).programs.find((program) => program.program.id === programId) ?? null;
  }

  async games(filters: Record<string, string | undefined>) {
    return new ScheduleService().listWatchedGames(await this.snapshot(), {
      programId: filters.programId,
      status: filters.status,
      court: filters.court,
      division: filters.division
    });
  }

  async game(gameId: string) {
    const snapshot = await this.snapshot();
    const game = snapshot.games.find((item) => item.id === gameId);
    return game ? { ...game, changeHistory: snapshot.changeEvents.filter((event) => event.gameId === gameId) } : null;
  }

  async teams(search?: string) {
    const snapshot = await this.snapshot();
    const normalized = normalizeName(search);
    return normalized ? snapshot.teams.filter((team) => team.normalizedName.includes(normalized)) : snapshot.teams;
  }

  async team(teamId: string) {
    return (await this.snapshot()).teams.find((team) => team.id === teamId) ?? null;
  }

  async alerts() {
    return (await this.snapshot()).changeEvents.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  async addAlias(programId: string, aliasValue: string) {
    const alias = await this.prisma.programAlias.upsert({
      where: {
        programWatchlistId_normalizedAlias: {
          programWatchlistId: programId,
          normalizedAlias: normalizeProgramName(aliasValue)
        }
      },
      update: { alias: aliasValue },
      create: {
        programWatchlistId: programId,
        alias: aliasValue,
        normalizedAlias: normalizeProgramName(aliasValue)
      }
    });
    await this.syncNow();
    return {
      id: alias.id,
      programWatchlistId: alias.programWatchlistId,
      alias: alias.alias,
      normalizedAlias: alias.normalizedAlias,
      createdAt: alias.createdAt.toISOString()
    };
  }

  async deleteAlias(programId: string, aliasId: string) {
    await this.prisma.programAlias.deleteMany({ where: { id: aliasId, programWatchlistId: programId } });
    await this.syncNow();
  }

  async syncNow() {
    const startedAt = new Date();
    const source = isExposureConfigured() ? "exposure_api" : "public_page";
    let teamsCount = 0;
    let gamesCount = 0;
    let changesDetected = 0;

    const event = await upsertEvent(this.prisma);
    const run = await this.prisma.syncRun.create({
      data: { eventId: event.id, startedAt, status: "running", source, teamsCount: 0, gamesCount: 0, changesDetected: 0 }
    });

    try {
      const sourceTeams = await fetchSourceTeams();
      const includeMockArsenal = process.env.ENABLE_MOCK_ARSENAL === "true" || sourceTeams.teams.length === 0;
      await ensurePrograms(this.prisma);
      if (!includeMockArsenal) await removeMockArsenalSeedData(this.prisma);
      await upsertSeedDivisionsTeamsAndGames(this.prisma, event.id, includeMockArsenal);

      for (const division of sourceTeams.divisions) {
        await upsertDivision(this.prisma, event.id, division);
      }
      for (const team of sourceTeams.teams) {
        await upsertTeam(this.prisma, event.id, team);
      }

      const exposureGames = await fetchSourceGames();
      const teamMap = await loadTeamMap(this.prisma, event.id);
      for (const sourceGame of exposureGames) {
        const mapped = mapExposureGame(sourceGame, event.id, teamMap);
        if (!mapped) continue;
        const existing = mapped.exposureGameId
          ? await this.prisma.game.findUnique({ where: { eventId_exposureGameId: { eventId: event.id, exposureGameId: mapped.exposureGameId } } })
          : null;
        const previousGame = existing ? prismaGameToCore(existing) : null;
        const changes = detectGameChanges(previousGame, mapped);
        const savedGame = await upsertGame(this.prisma, mapped);
        for (const change of changes) {
          await this.prisma.gameChangeEvent.upsert({
            where: { dedupeKey: change.dedupeKey },
            update: {},
            create: {
              gameId: savedGame.id,
              affectedTeamId: change.affectedTeamId,
              affectedProgramWatchlistId: change.affectedProgramWatchlistId,
              eventType: change.eventType,
              previousValue: change.previousValue as object,
              newValue: change.newValue as object,
              dedupeKey: change.dedupeKey
            }
          });
        }
      }

      const snapshot = await this.snapshot();
      const discovered = findProgramMatches(snapshot.teams, snapshot.programs, snapshot.aliases);
      for (const entry of discovered) {
        const existing = await this.prisma.programTeamMatch.findUnique({
          where: { programWatchlistId_teamId: { programWatchlistId: entry.program.id, teamId: entry.team.id } }
        });
        if (!existing) {
          await this.prisma.programTeamMatch.create({
            data: {
              programWatchlistId: entry.program.id,
              teamId: entry.team.id,
              matchType: entry.result.matchType ?? "normalized",
              matchConfidence: entry.result.confidence
            }
          });
          await this.prisma.gameChangeEvent.upsert({
            where: { dedupeKey: `team:${entry.program.id}:${entry.team.id}` },
            update: {},
            create: {
              affectedTeamId: entry.team.id,
              affectedProgramWatchlistId: entry.program.id,
              eventType: "new_team_discovered",
              previousValue: undefined,
              newValue: { teamName: entry.team.name, divisionName: entry.team.divisionName },
              dedupeKey: `team:${entry.program.id}:${entry.team.id}`
            }
          });
          changesDetected += 1;
        }
      }

      const after = await this.snapshot();
      teamsCount = after.teams.length;
      gamesCount = after.games.length;
      await this.prisma.event.update({ where: { id: event.id }, data: { lastSyncedAt: new Date() } });
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          completedAt: new Date(),
          teamsCount,
          gamesCount,
          changesDetected
        }
      });

      return { status: "success", source, teamsCount, gamesCount, changesDetected };
    } catch (error) {
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          teamsCount,
          gamesCount,
          changesDetected,
          errorMessage: error instanceof Error ? error.message : "Unknown sync error"
        }
      });
      throw error;
    }
  }
}

async function fetchSourceTeams(): Promise<{ divisions: Division[]; teams: Team[] }> {
  if (isExposureConfigured()) {
    try {
      const teams = await new ExposureClient().fetchTeams(config.EXPOSURE_EVENT_ID);
      const divisions = new Map<string, Division>();
      const mappedTeams = teams.map((team) => {
        const divisionName = String(team.Division?.Name ?? "Unknown Division");
        const divisionExposureId = String(team.Division?.Id ?? normalizeName(divisionName));
        const divisionId = `division-${divisionExposureId}`;
        const meta = extractDivisionMeta(divisionName);
        divisions.set(divisionId, {
          id: divisionId,
          eventId: seedEvent.id,
          exposureDivisionId: divisionExposureId,
          name: divisionName,
          ...meta,
          rawJson: team.Division ?? {}
        });
        return {
          id: `team-${team.Id}`,
          eventId: seedEvent.id,
          divisionId,
          exposureTeamId: String(team.Id),
          name: team.Name,
          normalizedName: normalizeName(team.Name),
          clubName: null,
          normalizedClubName: null,
          coachName: null,
          sourceUrl: `${seedEvent.officialUrl}/teams`,
          divisionName,
          ...meta,
          rawJson: team,
          lastSeenAt: new Date().toISOString()
        };
      });
      return { divisions: Array.from(divisions.values()), teams: mappedTeams };
    } catch {
      return new PublicExposurePageClient().fetchTeams(config.EXPOSURE_EVENT_ID);
    }
  }

  return new PublicExposurePageClient().fetchTeams(config.EXPOSURE_EVENT_ID);
}

async function fetchSourceGames() {
  if (!isExposureConfigured()) return [];
  try {
    return await new ExposureClient().fetchGames(config.EXPOSURE_EVENT_ID);
  } catch {
    return [];
  }
}

async function upsertEvent(prisma: PrismaClient) {
  return prisma.event.upsert({
    where: { exposureEventId: config.EXPOSURE_EVENT_ID },
    update: {
      name: seedEvent.name,
      organizer: seedEvent.organizer,
      location: seedEvent.location,
      officialUrl: seedEvent.officialUrl
    },
    create: {
      id: seedEvent.id,
      exposureEventId: seedEvent.exposureEventId,
      name: seedEvent.name,
      organizer: seedEvent.organizer,
      startDate: new Date(`${seedEvent.startDate}T00:00:00.000Z`),
      endDate: new Date(`${seedEvent.endDate}T00:00:00.000Z`),
      location: seedEvent.location,
      officialUrl: seedEvent.officialUrl,
      lastSyncedAt: seedEvent.lastSyncedAt ? new Date(seedEvent.lastSyncedAt) : null
    }
  });
}

async function ensurePrograms(prisma: PrismaClient) {
  for (const program of seedPrograms) {
    await prisma.programWatchlist.upsert({
      where: { id: program.id },
      update: {
        programName: program.programName,
        normalizedProgramName: program.normalizedProgramName,
        active: true
      },
      create: {
        id: program.id,
        userId: null,
        programName: program.programName,
        normalizedProgramName: program.normalizedProgramName,
        active: true,
        createdAt: new Date(program.createdAt)
      }
    });
  }
  for (const alias of seedAliases) {
    await prisma.programAlias.upsert({
      where: { id: alias.id },
      update: {
        alias: alias.alias,
        normalizedAlias: alias.normalizedAlias
      },
      create: {
        id: alias.id,
        programWatchlistId: alias.programWatchlistId,
        alias: alias.alias,
        normalizedAlias: alias.normalizedAlias,
        createdAt: new Date(alias.createdAt)
      }
    });
  }
}

async function upsertSeedDivisionsTeamsAndGames(prisma: PrismaClient, eventId: string, includeMockArsenal = true) {
  const allowedDivisions = seedDivisions.filter((division) => includeMockArsenal || !division.id.includes("arsenal"));
  const allowedTeams = seedTeams.filter((team) => includeMockArsenal || !team.id.includes("arsenal"));
  const allowedTeamIds = new Set(allowedTeams.map((team) => team.id));
  const allowedGames = seedGames.filter((game) => (game.homeTeamId ? allowedTeamIds.has(game.homeTeamId) : true) && (game.awayTeamId ? allowedTeamIds.has(game.awayTeamId) : true));
  const allowedGameIds = new Set(allowedGames.map((game) => game.id));

  for (const division of allowedDivisions) {
    await upsertDivision(prisma, eventId, division);
  }
  for (const team of allowedTeams) {
    await upsertTeam(prisma, eventId, team);
  }
  for (const game of allowedGames) {
    await upsertGame(prisma, { ...game, eventId });
  }
  for (const change of seedChangeEvents.filter((event) => !event.gameId || allowedGameIds.has(event.gameId))) {
    await prisma.gameChangeEvent.upsert({
      where: { dedupeKey: change.dedupeKey },
      update: {},
      create: {
        id: change.id,
        gameId: change.gameId,
        affectedTeamId: change.affectedTeamId,
        affectedProgramWatchlistId: change.affectedProgramWatchlistId,
        eventType: change.eventType,
        previousValue: change.previousValue as object,
        newValue: change.newValue as object,
        createdAt: new Date(change.createdAt),
        notificationSent: change.notificationSent,
        dedupeKey: change.dedupeKey
      }
    });
  }
}

async function removeMockArsenalSeedData(prisma: PrismaClient) {
  const mockTeamIds = seedTeams.filter((team) => team.id.includes("arsenal")).map((team) => team.id);
  const mockDivisionIds = seedDivisions.filter((division) => division.id.includes("arsenal")).map((division) => division.id);
  const mockTeamIdSet = new Set(mockTeamIds);
  const mockGameIds = seedGames
    .filter((game) => (game.homeTeamId ? mockTeamIdSet.has(game.homeTeamId) : false) || (game.awayTeamId ? mockTeamIdSet.has(game.awayTeamId) : false))
    .map((game) => game.id);

  await prisma.programTeamMatch.deleteMany({ where: { teamId: { in: mockTeamIds } } });
  await prisma.gameChangeEvent.deleteMany({
    where: {
      OR: [{ affectedTeamId: { in: mockTeamIds } }, { gameId: { in: mockGameIds } }]
    }
  });
  await prisma.game.deleteMany({ where: { id: { in: mockGameIds } } });
  await prisma.team.deleteMany({ where: { id: { in: mockTeamIds } } });
  await prisma.division.deleteMany({ where: { id: { in: mockDivisionIds } } });
}

async function upsertDivision(prisma: PrismaClient, eventId: string, division: Division) {
  const exposureDivisionId = division.exposureDivisionId ?? division.id;
  return prisma.division.upsert({
    where: { eventId_exposureDivisionId: { eventId, exposureDivisionId } },
    update: {
      name: division.name,
      gender: division.gender,
      gradeLevel: division.gradeLevel,
      level: division.level,
      rawJson: (division.rawJson ?? {}) as object
    },
    create: {
      id: division.id,
      eventId,
      exposureDivisionId,
      name: division.name,
      gender: division.gender,
      gradeLevel: division.gradeLevel,
      level: division.level,
      rawJson: (division.rawJson ?? {}) as object
    }
  });
}

async function upsertTeam(prisma: PrismaClient, eventId: string, team: Team) {
  return prisma.team.upsert({
    where: { eventId_exposureTeamId: { eventId, exposureTeamId: team.exposureTeamId ?? team.id } },
    update: {
      divisionId: team.divisionId,
      name: team.name,
      normalizedName: normalizeName(team.name),
      clubName: team.clubName,
      normalizedClubName: team.clubName ? normalizeName(team.clubName) : null,
      coachName: team.coachName,
      sourceUrl: team.sourceUrl,
      rawJson: (team.rawJson ?? {}) as object,
      lastSeenAt: new Date()
    },
    create: {
      id: team.id,
      eventId,
      divisionId: team.divisionId,
      exposureTeamId: team.exposureTeamId ?? team.id,
      name: team.name,
      normalizedName: normalizeName(team.name),
      clubName: team.clubName,
      normalizedClubName: team.clubName ? normalizeName(team.clubName) : null,
      coachName: team.coachName,
      sourceUrl: team.sourceUrl,
      rawJson: (team.rawJson ?? {}) as object,
      lastSeenAt: new Date(team.lastSeenAt)
    }
  });
}

async function upsertGame(prisma: PrismaClient, game: Game) {
  return prisma.game.upsert({
    where: { eventId_exposureGameId: { eventId: game.eventId, exposureGameId: game.exposureGameId ?? game.id } },
    update: gameWrite(game),
    create: {
      id: game.id,
      eventId: game.eventId,
      exposureGameId: game.exposureGameId ?? game.id,
      ...gameWrite(game)
    }
  });
}

function gameWrite(game: Game) {
  return {
    divisionId: game.divisionId,
    gameNumber: game.gameNumber,
    gameType: game.gameType,
    scheduledDate: new Date(`${game.scheduledDate}T00:00:00.000Z`),
    scheduledTime: game.scheduledTime,
    startsAt: new Date(game.startsAt),
    timezone: game.timezone,
    venueName: game.venueName,
    courtName: game.courtName,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
    homeTeamNameSnapshot: game.homeTeamNameSnapshot,
    awayTeamNameSnapshot: game.awayTeamNameSnapshot,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    status: game.status,
    officialUrl: game.officialUrl,
    streamingUrl: game.streamingUrl,
    sourceHash: game.sourceHash,
    rawJson: (game.rawJson ?? {}) as object
  };
}

async function loadTeamMap(prisma: PrismaClient, eventId: string): Promise<Map<string, Team>> {
  const teams = await prisma.team.findMany({ where: { eventId }, include: { division: true } });
  return new Map(
    teams.flatMap((team) => {
      const coreTeam: Team = {
        id: team.id,
        eventId: team.eventId,
        divisionId: team.divisionId,
        exposureTeamId: team.exposureTeamId,
        name: team.name,
        normalizedName: team.normalizedName,
        clubName: team.clubName,
        normalizedClubName: team.normalizedClubName,
        coachName: team.coachName,
        sourceUrl: team.sourceUrl,
        divisionName: team.division?.name ?? null,
        gender: team.division?.gender ?? null,
        gradeLevel: team.division?.gradeLevel ?? null,
        level: team.division?.level ?? null,
        rawJson: team.rawJson,
        lastSeenAt: team.lastSeenAt.toISOString()
      };
      return [
        [team.id, coreTeam],
        ...(team.exposureTeamId ? ([[team.exposureTeamId, coreTeam]] as Array<[string, Team]>) : [])
      ] as Array<[string, Team]>;
    })
  );
}

function mapExposureGame(raw: Record<string, unknown>, eventId: string, teamMap: Map<string, Team>): Game | null {
  const id = String(raw.Id ?? "");
  if (!id) return null;
  const division = raw.Division as { Id?: number | string; Name?: string } | undefined;
  const venueCourt = raw.VenueCourt as { Court?: { Name?: string }; Venue?: { Name?: string } } | undefined;
  const home = raw.HomeTeam as { TeamId?: number | string; Name?: string; Score?: number } | undefined;
  const away = raw.AwayTeam as { TeamId?: number | string; Name?: string; Score?: number } | undefined;
  const homeTeam = home?.TeamId ? teamMap.get(String(home.TeamId)) : null;
  const awayTeam = away?.TeamId ? teamMap.get(String(away.TeamId)) : null;
  const date = String(raw.Date ?? seedEvent.startDate);
  const time = String(raw.Time ?? "12:00 PM");
  const startsAt = parseRenoDateTime(date, time);
  const rawHash = hashSource(raw);

  return {
    id: `game-${id}`,
    eventId,
    divisionId: division?.Id ? `division-${division.Id}` : null,
    exposureGameId: id,
    gameNumber: raw.Number ? String(raw.Number) : null,
    gameType: raw.BracketName ? `Bracket ${String(raw.BracketName)}` : raw.Type ? String(raw.Type) : null,
    scheduledDate: toIsoDate(date),
    scheduledTime: time,
    startsAt: startsAt.toISOString(),
    timezone: RENO_TIMEZONE,
    venueName: venueCourt?.Venue?.Name ?? null,
    courtName: venueCourt?.Court?.Name ?? null,
    homeTeamId: homeTeam?.id ?? null,
    awayTeamId: awayTeam?.id ?? null,
    homeTeamNameSnapshot: homeTeam?.name ?? home?.Name ?? null,
    awayTeamNameSnapshot: awayTeam?.name ?? away?.Name ?? null,
    homeScore: typeof home?.Score === "number" ? home.Score : null,
    awayScore: typeof away?.Score === "number" ? away.Score : null,
    status: typeof home?.Score === "number" && typeof away?.Score === "number" ? "final" : "upcoming",
    officialUrl: `${seedEvent.officialUrl}/schedule`,
    streamingUrl: null,
    updatedAt: new Date().toISOString(),
    sourceHash: rawHash,
    rawJson: raw
  };
}

function parseRenoDateTime(date: string, time: string): Date {
  const [month = "5", day = "23", year = "2026"] = date.split("/");
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  let hour = Number(match?.[1] ?? 12);
  const minute = Number(match?.[2] ?? 0);
  const meridiem = (match?.[3] ?? "PM").toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  const local = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  return fromZonedTime(local, RENO_TIMEZONE);
}

function toIsoDate(date: string): string {
  const [month = "5", day = "23", year = "2026"] = date.split("/");
  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function prismaGameToCore(game: Awaited<ReturnType<PrismaClient["game"]["findFirst"]>> extends infer T ? NonNullable<T> : never): Game {
  return {
    id: game.id,
    eventId: game.eventId,
    divisionId: game.divisionId,
    exposureGameId: game.exposureGameId,
    gameNumber: game.gameNumber,
    gameType: game.gameType,
    scheduledDate: game.scheduledDate.toISOString().slice(0, 10),
    scheduledTime: game.scheduledTime,
    startsAt: game.startsAt.toISOString(),
    timezone: game.timezone,
    venueName: game.venueName,
    courtName: game.courtName,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
    homeTeamNameSnapshot: game.homeTeamNameSnapshot,
    awayTeamNameSnapshot: game.awayTeamNameSnapshot,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    status: game.status as Game["status"],
    officialUrl: game.officialUrl,
    streamingUrl: game.streamingUrl,
    updatedAt: game.updatedAt.toISOString(),
    sourceHash: game.sourceHash,
    rawJson: game.rawJson
  };
}

function toCoreChange(change: {
  id: string;
  gameId: string | null;
  affectedTeamId: string | null;
  affectedProgramWatchlistId: string | null;
  eventType: string;
  previousValue: unknown;
  newValue: unknown;
  createdAt: Date;
  notificationSent: boolean;
  dedupeKey: string;
}): GameChangeEvent {
  return {
    id: change.id,
    gameId: change.gameId,
    affectedTeamId: change.affectedTeamId,
    affectedProgramWatchlistId: change.affectedProgramWatchlistId,
    eventType: change.eventType as GameChangeEvent["eventType"],
    previousValue: change.previousValue,
    newValue: change.newValue,
    createdAt: change.createdAt.toISOString(),
    notificationSent: change.notificationSent,
    dedupeKey: change.dedupeKey
  };
}
