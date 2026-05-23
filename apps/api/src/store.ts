import type { PrismaClient } from "@courtwatch/db";
import {
  DashboardService,
  ExposureClient,
  LEGACY_AUTO_PROGRAM_IDS,
  PublicExposurePageClient,
  RENO_TIMEZONE,
  ScheduleService,
  SELECTED_TEAMS_PROGRAM_ID,
  SELECTED_TEAMS_PROGRAM_NAME,
  buildDashboard,
  detectGameChanges,
  extractDivisionMeta,
  hashSource,
  normalizeName,
  normalizeProgramName,
  watchedAlertEvents,
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
  Player,
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
  players(search?: string): Promise<Player[]>;
  team(teamId: string): Promise<Team | null>;
  alerts(): Promise<GameChangeEvent[]>;
  followTeam(teamId: string): Promise<ProgramTeamMatch>;
  unfollowTeam(teamId: string): Promise<void>;
  addAlias(programId: string, alias: string): Promise<ProgramAlias>;
  deleteAlias(programId: string, aliasId: string): Promise<void>;
  syncNow(): Promise<{ status: string; source: string; teamsCount: number; gamesCount: number; changesDetected: number }>;
}

export class MockStore implements CourtWatchStore {
  private data: CourtWatchSnapshot;

  constructor(initialData: CourtWatchSnapshot = seedSnapshot) {
    this.data = structuredClone(initialData);
  }

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
    return filterTeamsForSearch(snapshot, normalized);
  }

  async players(search?: string) {
    const normalized = normalizeName(search);
    const snapshot = await this.snapshot();
    return normalized ? snapshot.players.filter((player) => player.normalizedName.includes(normalized)) : snapshot.players;
  }

  async team(teamId: string) {
    return (await this.snapshot()).teams.find((team) => team.id === teamId) ?? null;
  }

  async alerts() {
    const dashboard = await this.dashboard();
    return dashboard.alerts;
  }

  async followTeam(teamId: string) {
    const team = this.data.teams.find((item) => item.id === teamId);
    if (!team) throw new Error("Team not found");
    const existing = this.data.matches.find((match) => match.programWatchlistId === SELECTED_TEAMS_PROGRAM_ID && match.teamId === teamId);
    if (existing) {
      existing.active = true;
      return structuredClone(existing);
    }
    const match: ProgramTeamMatch = {
      id: `match-selected-${teamId}`,
      programWatchlistId: SELECTED_TEAMS_PROGRAM_ID,
      teamId,
      matchType: "manual",
      matchConfidence: 1,
      active: true,
      createdAt: new Date().toISOString()
    };
    this.data.matches.push(match);
    return structuredClone(match);
  }

  async unfollowTeam(teamId: string) {
    this.data.matches = this.data.matches.map((match) =>
      match.programWatchlistId === SELECTED_TEAMS_PROGRAM_ID && match.teamId === teamId ? { ...match, active: false } : match
    );
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

    const [divisions, teams, players, programs, aliases, matches, games, changeEvents, syncRuns] = await Promise.all([
      this.prisma.division.findMany({ where: { eventId: event.id } }),
      this.prisma.team.findMany({ where: { eventId: event.id }, include: { division: true } }),
      this.prisma.player.findMany({ where: { eventId: event.id } }),
      this.prisma.programWatchlist.findMany({ where: { active: true } }),
      this.prisma.programAlias.findMany(),
      this.prisma.programTeamMatch.findMany({ where: { active: true } }),
      this.prisma.game.findMany({ where: { eventId: event.id }, orderBy: { startsAt: "asc" } }),
      this.prisma.gameChangeEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.syncRun.findMany({ where: { eventId: event.id }, orderBy: { startedAt: "desc" }, take: 20 })
    ]);
    const playerNamesByTeam = groupPlayerNamesByTeam(players.map(prismaPlayerToCore));
    const followedTeamIds = new Set(matches.filter((match) => match.active && match.programWatchlistId === SELECTED_TEAMS_PROGRAM_ID).map((match) => match.teamId));

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
        lastSeenAt: team.lastSeenAt.toISOString(),
        playerNames: playerNamesByTeam.get(team.id) ?? [],
        isFollowed: followedTeamIds.has(team.id)
      })),
      players: players.map(prismaPlayerToCore),
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
    return filterTeamsForSearch(snapshot, normalized);
  }

  async players(search?: string) {
    const snapshot = await this.snapshot();
    const normalized = normalizeName(search);
    return normalized ? snapshot.players.filter((player) => player.normalizedName.includes(normalized)) : snapshot.players;
  }

  async team(teamId: string) {
    return (await this.snapshot()).teams.find((team) => team.id === teamId) ?? null;
  }

  async alerts() {
    const snapshot = await this.snapshot();
    const activeProgramIds = new Set(snapshot.programs.map((program) => program.id));
    const watchedTeamIds = new Set(snapshot.matches.filter((match) => match.active && activeProgramIds.has(match.programWatchlistId)).map((match) => match.teamId));
    const watchedGameIds = new Set(
      snapshot.games.filter((game) => watchedTeamIds.has(game.homeTeamId ?? "") || watchedTeamIds.has(game.awayTeamId ?? "")).map((game) => game.id)
    );
    return watchedAlertEvents(snapshot.changeEvents, watchedTeamIds, watchedGameIds).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  async followTeam(teamId: string) {
    await ensurePrograms(this.prisma);
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new Error("Team not found");
    const match = await this.prisma.programTeamMatch.upsert({
      where: { programWatchlistId_teamId: { programWatchlistId: SELECTED_TEAMS_PROGRAM_ID, teamId } },
      update: { active: true, matchType: "manual", matchConfidence: 1 },
      create: {
        programWatchlistId: SELECTED_TEAMS_PROGRAM_ID,
        teamId,
        matchType: "manual",
        matchConfidence: 1
      }
    });
    return prismaMatchToCore(match);
  }

  async unfollowTeam(teamId: string) {
    await this.prisma.programTeamMatch.updateMany({
      where: { programWatchlistId: SELECTED_TEAMS_PROGRAM_ID, teamId },
      data: { active: false }
    });
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

      const teamMap = await loadTeamMap(this.prisma, event.id);
      const sourcePlayers = await fetchSourcePlayers(event.id, teamMap);
      for (const player of sourcePlayers) {
        await upsertPlayer(this.prisma, event.id, player);
      }

      const exposureGames = await fetchSourceGames();
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

async function fetchSourcePlayers(eventId: string, teamMap: Map<string, Team>): Promise<Player[]> {
  if (!isExposureConfigured()) return [];
  try {
    const players = await new ExposureClient().fetchPlayers(config.EXPOSURE_EVENT_ID);
    return players
      .map((player) => mapExposurePlayer(player, eventId, teamMap))
      .filter((player): player is Player => Boolean(player));
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
  await prisma.programWatchlist.updateMany({ where: { id: { in: LEGACY_AUTO_PROGRAM_IDS } }, data: { active: false } });
  for (const program of seedPrograms) {
    await prisma.programWatchlist.upsert({
      where: { id: program.id },
      update: {
        programName: SELECTED_TEAMS_PROGRAM_NAME,
        normalizedProgramName: normalizeProgramName(SELECTED_TEAMS_PROGRAM_NAME),
        active: true
      },
      create: {
        id: program.id,
        userId: null,
        programName: SELECTED_TEAMS_PROGRAM_NAME,
        normalizedProgramName: normalizeProgramName(SELECTED_TEAMS_PROGRAM_NAME),
        active: true,
        createdAt: new Date(program.createdAt)
      }
    });
  }
  const seenAliases = new Set<string>();
  for (const alias of seedAliases) {
    const aliasKey = `${alias.programWatchlistId}:${alias.normalizedAlias}`;
    if (seenAliases.has(aliasKey)) continue;
    seenAliases.add(aliasKey);
    await prisma.programAlias.upsert({
      where: {
        programWatchlistId_normalizedAlias: {
          programWatchlistId: alias.programWatchlistId,
          normalizedAlias: alias.normalizedAlias
        }
      },
      update: {
        alias: alias.alias
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

async function upsertPlayer(prisma: PrismaClient, eventId: string, player: Player) {
  const exposurePlayerId = player.exposurePlayerId ?? player.id;
  return prisma.player.upsert({
    where: { eventId_exposurePlayerId: { eventId, exposurePlayerId } },
    update: {
      teamId: player.teamId,
      firstName: player.firstName,
      lastName: player.lastName,
      fullName: player.fullName,
      normalizedName: normalizeName(player.fullName),
      jerseyNumber: player.jerseyNumber,
      position: player.position,
      grade: player.grade,
      rawJson: (player.rawJson ?? {}) as object,
      lastSeenAt: new Date()
    },
    create: {
      id: player.id,
      eventId,
      teamId: player.teamId,
      exposurePlayerId,
      firstName: player.firstName,
      lastName: player.lastName,
      fullName: player.fullName,
      normalizedName: normalizeName(player.fullName),
      jerseyNumber: player.jerseyNumber,
      position: player.position,
      grade: player.grade,
      rawJson: (player.rawJson ?? {}) as object,
      lastSeenAt: new Date(player.lastSeenAt)
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

function mapExposurePlayer(raw: Record<string, unknown>, eventId: string, teamMap: Map<string, Team>): Player | null {
  const id = stringOrNull(raw.Id);
  if (!id) return null;
  const profile = isRecord(raw.Profile) ? raw.Profile : {};
  const firstName = stringOrNull(raw.FirstName);
  const lastName = stringOrNull(raw.LastName);
  const fullName = stringOrNull(raw.Name) ?? [firstName, lastName].filter(Boolean).join(" ").trim();
  if (!fullName) return null;
  const team = extractExposureTeamIds(raw)
    .map((teamId) => teamMap.get(teamId))
    .find((item): item is Team => Boolean(item));

  return {
    id: `player-${id}`,
    eventId,
    teamId: team?.id ?? null,
    exposurePlayerId: id,
    firstName,
    lastName,
    fullName,
    normalizedName: normalizeName(fullName),
    jerseyNumber: stringOrNull(raw.Number) ?? stringOrNull(raw.JerseyNumber),
    position: stringOrNull(raw.Position) ?? stringOrNull(profile.Position),
    grade: stringOrNull(raw.Grade) ?? stringOrNull(profile.Grade),
    rawJson: raw,
    lastSeenAt: new Date().toISOString()
  };
}

function extractExposureTeamIds(raw: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  for (const key of ["TeamId", "TeamID", "DivisionTeamId", "DivisionTeamID"]) {
    const value = stringOrNull(raw[key]);
    if (value) ids.add(value);
  }
  if (isRecord(raw.Team)) {
    const value = stringOrNull(raw.Team.Id ?? raw.Team.TeamId);
    if (value) ids.add(value);
  }
  if (Array.isArray(raw.Teams)) {
    for (const team of raw.Teams) {
      if (!isRecord(team)) continue;
      const value = stringOrNull(team.Id ?? team.TeamId);
      if (value) ids.add(value);
    }
  }
  return Array.from(ids);
}

function filterTeamsForSearch(snapshot: CourtWatchSnapshot, normalizedSearch: string): Team[] {
  const activeProgramIds = new Set(snapshot.programs.filter((program) => program.active).map((program) => program.id));
  const followedTeamIds = new Set(snapshot.matches.filter((match) => match.active && activeProgramIds.has(match.programWatchlistId)).map((match) => match.teamId));
  const playerNamesByTeam = groupPlayerNamesByTeam(snapshot.players);

  return snapshot.teams
    .map((team) => {
      const playerNames = playerNamesByTeam.get(team.id) ?? team.playerNames ?? [];
      const playerMatchNames = normalizedSearch ? playerNames.filter((name) => normalizeName(name).includes(normalizedSearch)) : [];
      return {
        ...team,
        playerNames,
        playerMatchNames,
        isFollowed: followedTeamIds.has(team.id)
      };
    })
    .filter((team) => {
      if (!normalizedSearch) return true;
      return (
        team.normalizedName.includes(normalizedSearch) ||
        normalizeName(team.clubName).includes(normalizedSearch) ||
        normalizeName(team.divisionName).includes(normalizedSearch) ||
        team.playerMatchNames.length > 0
      );
    })
    .sort((left, right) => Number(right.isFollowed) - Number(left.isFollowed) || (left.divisionName ?? "").localeCompare(right.divisionName ?? "") || left.name.localeCompare(right.name));
}

function groupPlayerNamesByTeam(players: Player[]): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const player of players) {
    if (!player.teamId) continue;
    names.set(player.teamId, [...(names.get(player.teamId) ?? []), player.fullName]);
  }
  return names;
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

function prismaPlayerToCore(player: {
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
  rawJson: unknown;
  lastSeenAt: Date;
}): Player {
  return {
    id: player.id,
    eventId: player.eventId,
    teamId: player.teamId,
    exposurePlayerId: player.exposurePlayerId,
    firstName: player.firstName,
    lastName: player.lastName,
    fullName: player.fullName,
    normalizedName: player.normalizedName,
    jerseyNumber: player.jerseyNumber,
    position: player.position,
    grade: player.grade,
    rawJson: player.rawJson,
    lastSeenAt: player.lastSeenAt.toISOString()
  };
}

function prismaMatchToCore(match: {
  id: string;
  programWatchlistId: string;
  teamId: string;
  matchType: string;
  matchConfidence: unknown;
  active: boolean;
  createdAt: Date;
}): ProgramTeamMatch {
  return {
    id: match.id,
    programWatchlistId: match.programWatchlistId,
    teamId: match.teamId,
    matchType: match.matchType as MatchType,
    matchConfidence: Number(match.matchConfidence),
    active: match.active,
    createdAt: match.createdAt.toISOString()
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
