import { Prisma, type PrismaClient } from "@courtwatch/db";
import {
  DashboardService,
  ExposureClient,
  LEGACY_AUTO_PROGRAM_IDS,
  PublicExposurePageClient,
  RENO_TIMEZONE,
  ScheduleService,
  CourtFinderService,
  SELECTED_TEAMS_PROGRAM_ID,
  SELECTED_TEAMS_PROGRAM_NAME,
  TournamentDiscoveryService,
  buildDashboard,
  buildDivisionResultGroups,
  buildTeamScoringLeaders,
  detectGameChanges,
  deriveTournamentStatus,
  deriveDivisionResultsFromGames,
  eligibleTournamentEvents,
  extractDivisionMeta,
  hashSource,
  courtWatchSupportedTournamentRegion,
  isCourtWatchSupportedTournamentRegion,
  normalizeName,
  normalizeProgramName,
  sanitizeBasketballScore,
  watchedAlertsForSnapshot,
  seedAliases,
  seedChangeEvents,
  seedDivisions,
  seedGames,
  seedPrograms,
  seedSnapshot,
  seedTeams,
  RECENT_COMPLETED_TOURNAMENT_DAYS,
  tournamentTodayKey,
  tournamentWindowEndKey,
  withEffectiveGameStatus,
} from "@courtwatch/core";
import type {
  CourtWatchSnapshot,
  CourtSummary,
  Division,
  DivisionResult,
  DivisionResultGroup,
  FavoriteTeamWatch,
  FavoriteTeamWatchInput,
  Game,
  GameChangeEvent,
  MatchType,
  Player,
  ProgramAlias,
  ProgramTeamMatch,
  ProgramWatchlist,
  ResultMedalLabel,
  ResultPlacement,
  ResultSource,
  SyncStatus,
  Team,
  TeamScoringLeader,
  TeamRecordSummary,
  PublicTournamentCandidate,
  TournamentEvent,
} from "@courtwatch/core";
import { fromZonedTime } from "date-fns-tz";
import { createHash } from "node:crypto";
import {
  config,
  configuredTournaments,
  isExposureConfigured,
  majorTournamentSources,
  tournamentForExposureEventId,
} from "./config.js";
import type { TournamentSource } from "./config.js";

const teamSortCollator = new Intl.Collator("en-US", {
  numeric: true,
  sensitivity: "base",
});

const activeGameHydrationPromises = new Map<number, Promise<void>>();
const ACTIVE_GAME_HYDRATION_STALE_MS = Math.max(
  30_000,
  Number(process.env.ACTIVE_GAME_HYDRATION_STALE_MS ?? 90_000),
);
const RECENTLY_COMPLETED_HYDRATION_DAYS = Math.max(
  1,
  Number(process.env.RECENTLY_COMPLETED_HYDRATION_DAYS ?? 3),
);
const EVENTS_CACHE_TTL_MS = Math.max(
  5_000,
  Number(process.env.EVENTS_CACHE_TTL_MS ?? 30_000),
);
const TEAM_LIST_HYDRATION_STALE_MS = Math.max(
  60_000,
  Number(process.env.TEAM_LIST_HYDRATION_STALE_MS ?? 15 * 60_000),
);
const TEAM_LIST_HYDRATION_WINDOW_DAYS = Math.max(
  1,
  Number(process.env.TEAM_LIST_HYDRATION_WINDOW_DAYS ?? 14),
);
let publicEventsCache: { expiresAt: number; events: TournamentEvent[] } | null =
  null;

function invalidateEventsCache() {
  publicEventsCache = null;
}

function publicEventsCacheHit(): TournamentEvent[] | null {
  if (!publicEventsCache || publicEventsCache.expiresAt <= Date.now()) {
    publicEventsCache = null;
    return null;
  }
  return publicEventsCache.events.map(cloneTournamentEvent);
}

function writePublicEventsCache(events: TournamentEvent[]) {
  publicEventsCache = {
    expiresAt: Date.now() + EVENTS_CACHE_TTL_MS,
    events: events.map(cloneTournamentEvent),
  };
}

function cloneTournamentEvent(event: TournamentEvent): TournamentEvent {
  return {
    ...event,
    sanctioningTags: [...event.sanctioningTags],
    ageOrGradeDivisions: [...event.ageOrGradeDivisions],
  };
}

function courtWatchEventScopeWhere(): Prisma.EventWhereInput {
  return {
    OR: [
      { state: { in: ["CA", "Ca", "ca", "California", "california"] } },
      { state: { in: ["NV", "Nv", "nv", "Nevada", "nevada"] } },
      { location: { contains: "California" } },
      { location: { contains: ", CA" } },
      { location: { contains: "Nevada" } },
      { location: { contains: ", NV" } },
      {
        region: {
          in: [
            "CA",
            "California",
            "Northern California",
            "Southern California",
            "NV",
            "Nevada",
          ],
        },
      },
    ],
  };
}

function courtWatchScopedEventWhere(
  where: Prisma.EventWhereInput,
): Prisma.EventWhereInput {
  return { AND: [courtWatchEventScopeWhere(), where] };
}

function courtWatchDropdownEventWhere(
  trackedExposureEventIds: Set<number>,
): Prisma.EventWhereInput {
  const todayKey = tournamentTodayKey();
  const windowEndKey = tournamentWindowEndKey(
    todayKey,
    config.TOURNAMENT_DISCOVERY_WINDOW_DAYS,
  );
  const recentCompletedStartKey = addDaysKey(
    todayKey,
    -RECENT_COMPLETED_TOURNAMENT_DAYS,
  );
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const windowEnd = new Date(`${windowEndKey}T00:00:00.000Z`);
  const recentCompletedStart = new Date(
    `${recentCompletedStartKey}T00:00:00.000Z`,
  );
  const trackedExposureIds = Array.from(trackedExposureEventIds);

  return courtWatchScopedEventWhere({
    status: { notIn: ["cancelled", "unavailable"] },
    OR: [
      {
        startDate: { lte: windowEnd },
        endDate: { gte: today },
      },
      {
        endDate: { gte: recentCompletedStart, lt: today },
        hasPublicTeamList: true,
      },
      ...(trackedExposureIds.length > 0
        ? [{ exposureEventId: { in: trackedExposureIds } }]
        : []),
    ],
  });
}

function withTrackedDropdownGroups(
  events: TournamentEvent[],
  trackedExposureEventIds: Set<number>,
): TournamentEvent[] {
  return events.map((event) => ({
    ...event,
    dropdownGroup: trackedExposureEventIds.has(event.exposureEventId)
      ? "tracked"
      : event.dropdownGroup,
  }));
}

function mergeDropdownEvents(events: TournamentEvent[]): TournamentEvent[] {
  const byExposureId = new Map<number, TournamentEvent>();
  for (const event of events) {
    byExposureId.set(event.exposureEventId, event);
  }
  return sortTournamentEvents(Array.from(byExposureId.values()));
}

export interface CourtWatchStore {
  events(clientId?: string | null): Promise<TournamentEvent[]>;
  snapshot(exposureEventId?: number | null): Promise<CourtWatchSnapshot>;
  syncStatus(
    exposureEventId?: number | null,
    scope?: "event" | "all",
  ): Promise<SyncStatus>;
  dashboard(
    clientId?: string | null,
    exposureEventId?: number | null,
  ): Promise<ReturnType<typeof buildDashboard>>;
  program(
    programId: string,
    clientId?: string | null,
    exposureEventId?: number | null,
  ): Promise<ReturnType<DashboardService["build"]>["programs"][number] | null>;
  games(
    filters: Record<string, string | undefined>,
    clientId?: string | null,
    exposureEventId?: number | null,
  ): Promise<Game[]>;
  courts(exposureEventId?: number | null): Promise<CourtSummary[]>;
  game(
    gameId: string,
  ): Promise<(Game & { changeHistory: GameChangeEvent[] }) | null>;
  teams(
    search?: string,
    clientId?: string | null,
    exposureEventId?: number | null,
    allEvents?: boolean,
    limit?: number,
  ): Promise<Team[]>;
  favoriteTeamWatches(clientId?: string | null): Promise<FavoriteTeamWatch[]>;
  saveFavoriteTeamWatch(
    input: FavoriteTeamWatchInput,
    clientId?: string | null,
  ): Promise<FavoriteTeamWatch>;
  deleteFavoriteTeamWatch(
    watchId: string,
    clientId?: string | null,
  ): Promise<void>;
  scoringLeaders(
    clientId?: string | null,
    exposureEventId?: number | null,
  ): Promise<TeamScoringLeader[]>;
  team(teamId: string): Promise<Team | null>;
  results(
    clientId?: string | null,
    scope?: "watched" | "all",
    exposureEventId?: number | null,
  ): Promise<DivisionResultGroup[]>;
  alerts(
    clientId?: string | null,
    exposureEventId?: number | null,
  ): Promise<GameChangeEvent[]>;
  followTeam(
    teamId: string,
    clientId?: string | null,
  ): Promise<ProgramTeamMatch>;
  unfollowTeam(teamId: string, clientId?: string | null): Promise<void>;
  addAlias(programId: string, alias: string): Promise<ProgramAlias>;
  deleteAlias(programId: string, aliasId: string): Promise<void>;
  syncNow(exposureEventId?: number | null): Promise<{
    status: string;
    source: string;
    teamsCount: number;
    gamesCount: number;
    changesDetected: number;
  }>;
  discoverTournaments(): Promise<{
    status: string;
    discoveredCount: number;
    syncedCount: number;
    failures: Array<{ provider: string; source: string; message: string }>;
  }>;
}

export class MockStore implements CourtWatchStore {
  private data: CourtWatchSnapshot;
  private favoriteWatches: Array<FavoriteTeamWatch & { ownerHash: string }> =
    [];

  constructor(initialData: CourtWatchSnapshot = seedSnapshot) {
    this.data = structuredClone(initialData);
  }

  async events(clientId?: string | null): Promise<TournamentEvent[]> {
    const program = this.ensureSelectedProgram(clientId);
    const followedTeamIds = new Set(
      this.data.matches
        .filter(
          (match) => match.active && match.programWatchlistId === program.id,
        )
        .map((match) => match.teamId),
    );
    const trackedEventIds = new Set(
      this.data.teams
        .filter((team) => followedTeamIds.has(team.id))
        .map((team) => team.eventId),
    );
    return structuredClone(
      dropdownEventsFromSnapshot(this.data.events, this.data.teams).map(
        (event) => ({
          ...event,
          dropdownGroup: trackedEventIds.has(event.id) ? "tracked" : "upcoming",
        }),
      ),
    );
  }

  async snapshot(exposureEventId?: number | null): Promise<CourtWatchSnapshot> {
    return snapshotForTournament(structuredClone(this.data), exposureEventId);
  }

  async syncStatus(
    exposureEventId?: number | null,
    scope: "event" | "all" = "event",
  ): Promise<SyncStatus> {
    if (scope === "all") {
      const lastSyncedAt =
        this.data.syncRuns
          .filter((run) => run.status === "success" && run.completedAt)
          .map((run) => run.completedAt)
          .sort()
          .at(-1) ??
        this.data.events
          .map((event) => event.lastSyncedAt)
          .filter(Boolean)
          .sort()
          .at(-1) ??
        null;
      const lastCheckedAt =
        this.data.events
          .map((event) => event.lastCheckedAt)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;
      const lastTeamChangeAt =
        this.data.events
          .map((event) => event.lastTeamChangeAt)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;
      const latestChangeAt =
        this.data.changeEvents
          .map((event) => event.createdAt)
          .sort()
          .at(-1) ?? null;
      return {
        scope,
        exposureEventId: null,
        lastSyncedAt,
        lastCheckedAt,
        lastTeamChangeAt,
        latestChangeAt,
        latestSuccessfulSyncAt: lastSyncedAt,
        fingerprint: [
          scope,
          lastSyncedAt ?? "",
          lastCheckedAt ?? "",
          lastTeamChangeAt ?? "",
          latestChangeAt ?? "",
        ].join("|"),
      };
    }

    const snapshot = this.snapshotForClient(null, exposureEventId);
    const lastSyncedAt =
      snapshot.syncRuns
        .filter((run) => run.status === "success" && run.completedAt)
        .map((run) => run.completedAt)
        .sort()
        .at(-1) ?? snapshot.event.lastSyncedAt;
    const latestChangeAt =
      snapshot.changeEvents
        .map((event) => event.createdAt)
        .sort()
        .at(-1) ?? null;
    return {
      scope,
      exposureEventId: snapshot.event.exposureEventId,
      lastSyncedAt,
      lastCheckedAt: snapshot.event.lastCheckedAt,
      lastTeamChangeAt: snapshot.event.lastTeamChangeAt,
      latestChangeAt,
      latestSuccessfulSyncAt: lastSyncedAt,
      fingerprint: [
        snapshot.event.exposureEventId,
        lastSyncedAt ?? "",
        snapshot.event.lastTeamChangeAt ?? "",
        latestChangeAt ?? "",
      ].join("|"),
    };
  }

  async dashboard(clientId?: string | null, exposureEventId?: number | null) {
    return buildDashboard(this.snapshotForClient(clientId, exposureEventId));
  }

  async program(
    programId: string,
    clientId?: string | null,
    exposureEventId?: number | null,
  ) {
    return (
      (await this.dashboard(clientId, exposureEventId)).programs.find(
        (program) => program.program.id === programId,
      ) ?? null
    );
  }

  async games(
    filters: Record<string, string | undefined>,
    clientId?: string | null,
    exposureEventId?: number | null,
  ) {
    const schedule = new ScheduleService().listWatchedGames(
      this.snapshotForClient(clientId, exposureEventId),
      {
        programId: filters.programId,
        status: filters.status,
        court: filters.court,
        division: filters.division,
        scope: filters.scope,
      },
    );
    return schedule;
  }

  async courts(exposureEventId?: number | null) {
    await this.hydrateActiveGamesIfStale(exposureEventId);
    return new CourtFinderService().listCourts(
      await this.snapshot(exposureEventId),
    );
  }

  async game(gameId: string) {
    const snapshot = structuredClone(this.data);
    const game = snapshot.games.find((item) => item.id === gameId);
    return game
      ? {
          ...withEffectiveGameStatus(game),
          changeHistory: snapshot.changeEvents.filter(
            (event) => event.gameId === gameId,
          ),
        }
      : null;
  }

  async teams(
    search?: string,
    clientId?: string | null,
    exposureEventId?: number | null,
    allEvents = false,
    limit?: number,
  ) {
    const normalized = normalizeName(search);
    const program = this.ensureSelectedProgram(clientId);
    const snapshot = allEvents
      ? scopeSnapshot(structuredClone(this.data), program.id)
      : this.snapshotForClient(clientId, exposureEventId);
    const teams = filterTeamsForSearch(snapshot, normalized);
    return typeof limit === "number" ? teams.slice(0, limit) : teams;
  }

  async favoriteTeamWatches(
    clientId?: string | null,
  ): Promise<FavoriteTeamWatch[]> {
    const ownerHash = favoriteWatchOwnerHash(clientId);
    return structuredClone(
      this.favoriteWatches
        .filter((watch) => watch.ownerHash === ownerHash && watch.active)
        .map(({ ownerHash: _ownerHash, ...watch }) => watch),
    );
  }

  async saveFavoriteTeamWatch(
    input: FavoriteTeamWatchInput,
    clientId?: string | null,
  ): Promise<FavoriteTeamWatch> {
    const ownerHash = favoriteWatchOwnerHash(clientId);
    const displayName = input.displayName.trim();
    const normalizedName = normalizeName(displayName);
    const sourceTeamId = input.sourceTeamId?.trim() || null;
    const existing = this.favoriteWatches.find(
      (watch) =>
        watch.ownerHash === ownerHash &&
        watch.normalizedName === normalizedName &&
        (watch.sourceTeamId ?? null) === sourceTeamId,
    );
    if (existing) {
      existing.active = true;
      existing.displayName = displayName;
      existing.source = sourceTeamId ? "registered" : "custom";
      existing.sourceTeamName = input.sourceTeamName ?? null;
      existing.eventName = input.eventName ?? null;
      existing.divisionName = input.divisionName ?? null;
      existing.gender = input.gender ?? null;
      existing.gradeLevel = input.gradeLevel ?? null;
      existing.level = input.level ?? null;
      existing.updatedAt = new Date().toISOString();
      const { ownerHash: _ownerHash, ...watch } = existing;
      return structuredClone(watch);
    }
    const now = new Date().toISOString();
    const watch: FavoriteTeamWatch & { ownerHash: string } = {
      id: `favorite-watch-${ownerHash}-${Date.now()}`,
      ownerHash,
      displayName,
      normalizedName,
      source: sourceTeamId ? "registered" : "custom",
      sourceTeamId,
      sourceTeamName: input.sourceTeamName ?? null,
      eventName: input.eventName ?? null,
      divisionName: input.divisionName ?? null,
      gender: input.gender ?? null,
      gradeLevel: input.gradeLevel ?? null,
      level: input.level ?? null,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    this.favoriteWatches.push(watch);
    const { ownerHash: _ownerHash, ...savedWatch } = watch;
    return structuredClone(savedWatch);
  }

  async deleteFavoriteTeamWatch(
    watchId: string,
    clientId?: string | null,
  ): Promise<void> {
    const ownerHash = favoriteWatchOwnerHash(clientId);
    this.favoriteWatches = this.favoriteWatches.map((watch) =>
      watch.ownerHash === ownerHash && watch.id === watchId
        ? { ...watch, active: false, updatedAt: new Date().toISOString() }
        : watch,
    );
  }

  async scoringLeaders(
    clientId?: string | null,
    exposureEventId?: number | null,
  ) {
    const snapshot = this.snapshotForClient(clientId, exposureEventId);
    return buildTeamScoringLeaders(snapshot.games, snapshot.teams, {
      includeUnscoredTeams: true,
    });
  }

  async team(teamId: string) {
    return this.data.teams.find((team) => team.id === teamId) ?? null;
  }

  async alerts(clientId?: string | null, exposureEventId?: number | null) {
    const dashboard = await this.dashboard(clientId, exposureEventId);
    return dashboard.alerts;
  }

  async results(
    clientId?: string | null,
    scope: "watched" | "all" = "watched",
    exposureEventId?: number | null,
  ) {
    return buildDivisionResultGroups(
      this.snapshotForClient(clientId, exposureEventId),
      { scope },
    );
  }

  async followTeam(teamId: string, clientId?: string | null) {
    const team = this.data.teams.find((item) => item.id === teamId);
    if (!team) throw new Error("Team not found");
    const programId = this.ensureSelectedProgram(clientId).id;
    const existing = this.data.matches.find(
      (match) =>
        match.programWatchlistId === programId && match.teamId === teamId,
    );
    if (existing) {
      existing.active = true;
      return structuredClone(existing);
    }
    const match: ProgramTeamMatch = {
      id: `match-${programId}-${teamId}`,
      programWatchlistId: programId,
      teamId,
      matchType: "manual",
      matchConfidence: 1,
      active: true,
      createdAt: new Date().toISOString(),
    };
    this.data.matches.push(match);
    return structuredClone(match);
  }

  async unfollowTeam(teamId: string, clientId?: string | null) {
    const programId = this.ensureSelectedProgram(clientId).id;
    this.data.matches = this.data.matches.map((match) =>
      match.programWatchlistId === programId && match.teamId === teamId
        ? { ...match, active: false }
        : match,
    );
  }

  async addAlias(programId: string, aliasValue: string) {
    const alias: ProgramAlias = {
      id: `alias-${Date.now()}`,
      programWatchlistId: programId,
      alias: aliasValue,
      normalizedAlias: normalizeProgramName(aliasValue),
      createdAt: new Date().toISOString(),
    };
    this.data.aliases.push(alias);
    await this.syncNow();
    return alias;
  }

  async deleteAlias(programId: string, aliasId: string) {
    this.data.aliases = this.data.aliases.filter(
      (alias) =>
        !(alias.programWatchlistId === programId && alias.id === aliasId),
    );
  }

  async syncNow(exposureEventId?: number | null) {
    const selectedEvents = exposureEventId
      ? this.data.events.filter(
          (event) => event.exposureEventId === exposureEventId,
        )
      : this.data.events;
    const eventIds =
      selectedEvents.length > 0
        ? selectedEvents.map((event) => event.id)
        : [this.data.event.id];
    const teamsCount = this.data.teams.filter((team) =>
      eventIds.includes(team.eventId),
    ).length;
    const gamesCount = this.data.games.filter((game) =>
      eventIds.includes(game.eventId),
    ).length;
    const run = {
      id: `sync-${Date.now()}`,
      eventId: eventIds[0] ?? this.data.event.id,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: "success" as const,
      source: "mock" as const,
      teamsCount,
      gamesCount,
      changesDetected: 0,
      errorMessage: null,
    };
    this.data.events = this.data.events.map((event) =>
      eventIds.includes(event.id)
        ? {
            ...event,
            registeredTeamCount: this.data.teams.filter(
              (team) => team.eventId === event.id,
            ).length,
            hasPublicTeamList: this.data.teams.some(
              (team) => team.eventId === event.id,
            ),
            lastCheckedAt: run.completedAt,
            lastSyncedAt: run.completedAt,
            lastTeamChangeAt: event.lastTeamChangeAt ?? run.completedAt,
            status: deriveTournamentStatus(event),
          }
        : event,
    );
    this.data.event =
      this.data.events.find((event) => event.id === this.data.event.id) ??
      this.data.event;
    this.data.syncRuns.unshift(run);
    return {
      status: run.status,
      source: run.source,
      teamsCount: run.teamsCount,
      gamesCount: run.gamesCount,
      changesDetected: run.changesDetected,
    };
  }

  async discoverTournaments() {
    return {
      status: "success",
      discoveredCount: 0,
      syncedCount: 0,
      failures: [],
    };
  }

  private async hydrateActiveGamesIfStale(_exposureEventId?: number | null) {
    return;
  }

  private snapshotForClient(
    clientId?: string | null,
    exposureEventId?: number | null,
  ): CourtWatchSnapshot {
    const program = this.ensureSelectedProgram(clientId);
    return scopeSnapshot(
      snapshotForTournament(structuredClone(this.data), exposureEventId),
      program.id,
    );
  }

  private ensureSelectedProgram(clientId?: string | null): ProgramWatchlist {
    const programId = selectedProgramIdForClient(clientId);
    const existing = this.data.programs.find(
      (program) => program.id === programId,
    );
    if (existing) return existing;
    const program: ProgramWatchlist = {
      id: programId,
      userId: clientId ? selectedUserIdForClient(clientId) : null,
      programName: SELECTED_TEAMS_PROGRAM_NAME,
      normalizedProgramName: normalizeProgramName(SELECTED_TEAMS_PROGRAM_NAME),
      active: true,
      createdAt: new Date().toISOString(),
    };
    this.data.programs.push(program);
    return program;
  }
}

export class PrismaStore implements CourtWatchStore {
  constructor(private readonly prisma: PrismaClient) {}

  async events(clientId?: string | null): Promise<TournamentEvent[]> {
    const configured = configuredTournaments();
    const configuredByExposureId = new Map(
      configured.map((event) => [event.exposureEventId, event]),
    );
    const trackedExposureEventIds =
      await this.trackedExposureEventIdsForClient(clientId);
    const cached = publicEventsCacheHit();
    if (cached) {
      const cachedExposureIds = new Set(
        cached.map((event) => event.exposureEventId),
      );
      const missingTrackedExposureIds = Array.from(
        trackedExposureEventIds,
      ).filter((exposureEventId) => !cachedExposureIds.has(exposureEventId));
      const trackedEvents =
        missingTrackedExposureIds.length > 0
          ? await this.eventsForExposureIds(
              missingTrackedExposureIds,
              configuredByExposureId,
              trackedExposureEventIds,
            )
          : [];
      return mergeDropdownEvents(
        withTrackedDropdownGroups(cached, trackedExposureEventIds).concat(
          trackedEvents,
        ),
      );
    }
    const dbEvents = await this.prisma.event.findMany({
      where: courtWatchDropdownEventWhere(trackedExposureEventIds),
      orderBy: [{ startDate: "asc" }, { name: "asc" }],
    });
    const dbEventIds = dbEvents.map((event) => event.id);
    const [teamCounts, latestSuccesses] = await Promise.all([
      this.prisma.team.groupBy({
        by: ["eventId"],
        where: { eventId: { in: dbEventIds } },
        _count: { _all: true },
      }),
      this.prisma.syncRun.groupBy({
        by: ["eventId"],
        where: {
          eventId: { in: dbEventIds },
          status: "success",
          completedAt: { not: null },
        },
        _max: { completedAt: true },
      }),
    ]);
    const teamCountByEventId = new Map(
      teamCounts.map((count) => [count.eventId, count._count._all]),
    );
    const latestSuccessByEventId = new Map(
      latestSuccesses.map((run) => [
        run.eventId,
        run._max.completedAt?.toISOString() ?? null,
      ]),
    );
    const merged = new Map<number, TournamentEvent>();

    for (const event of configured.filter(
      isCourtWatchSupportedTournamentRegion,
    )) {
      merged.set(event.exposureEventId, event);
    }

    for (const event of dbEvents) {
      const source = configuredByExposureId.get(event.exposureEventId);
      const coreEvent = prismaEventToCore(
        event,
        source,
        teamCountByEventId.get(event.id),
        latestSuccessByEventId.get(event.id) ?? null,
      );
      if (isCourtWatchSupportedTournamentRegion(coreEvent)) {
        merged.set(event.exposureEventId, coreEvent);
      }
    }

    const events: TournamentEvent[] =
      dropdownEventsWithUpcomingExposureFallback(
        Array.from(merged.values()),
      ).map((event): TournamentEvent => {
        const supportedRegion = courtWatchSupportedTournamentRegion(event);
        return {
          ...event,
          region: supportedRegion ?? event.region,
          dropdownGroup: trackedExposureEventIds.has(event.exposureEventId)
            ? "tracked"
            : "upcoming",
        };
      });
    if (!clientId) writePublicEventsCache(events);
    return events;
  }

  private async eventsForExposureIds(
    exposureEventIds: number[],
    configuredByExposureId: Map<number, TournamentSource>,
    trackedExposureEventIds: Set<number>,
  ): Promise<TournamentEvent[]> {
    const dbEvents = await this.prisma.event.findMany({
      where: courtWatchScopedEventWhere({
        exposureEventId: { in: exposureEventIds },
        status: { notIn: ["cancelled", "unavailable"] },
      }),
      orderBy: [{ startDate: "asc" }, { name: "asc" }],
    });
    const dbEventIds = dbEvents.map((event) => event.id);
    const [teamCounts, latestSuccesses] = await Promise.all([
      this.prisma.team.groupBy({
        by: ["eventId"],
        where: { eventId: { in: dbEventIds } },
        _count: { _all: true },
      }),
      this.prisma.syncRun.groupBy({
        by: ["eventId"],
        where: {
          eventId: { in: dbEventIds },
          status: "success",
          completedAt: { not: null },
        },
        _max: { completedAt: true },
      }),
    ]);
    const teamCountByEventId = new Map(
      teamCounts.map((count) => [count.eventId, count._count._all]),
    );
    const latestSuccessByEventId = new Map(
      latestSuccesses.map((run) => [
        run.eventId,
        run._max.completedAt?.toISOString() ?? null,
      ]),
    );

    return dbEvents
      .map((event) => {
        const source = configuredByExposureId.get(event.exposureEventId);
        const coreEvent = prismaEventToCore(
          event,
          source,
          teamCountByEventId.get(event.id),
          latestSuccessByEventId.get(event.id) ?? null,
        );
        const supportedRegion = courtWatchSupportedTournamentRegion(coreEvent);
        return {
          ...coreEvent,
          region: supportedRegion ?? coreEvent.region,
          dropdownGroup: trackedExposureEventIds.has(coreEvent.exposureEventId)
            ? ("tracked" as const)
            : ("upcoming" as const),
        };
      })
      .filter(isCourtWatchSupportedTournamentRegion);
  }

  async snapshot(exposureEventId?: number | null): Promise<CourtWatchSnapshot> {
    const requestedTournament = tournamentForExposureEventId(exposureEventId);
    const event = await this.prisma.event.findUnique({
      where: { exposureEventId: requestedTournament.exposureEventId },
    });
    if (!event)
      return emptySnapshotForTournament(
        requestedTournament,
        await this.events(),
      );
    const tournament =
      configuredTournaments().find(
        (source) => source.exposureEventId === event.exposureEventId,
      ) ?? prismaEventToCore(event);

    const [
      divisions,
      teams,
      players,
      divisionResults,
      programs,
      aliases,
      matches,
      games,
      changeEvents,
      syncRuns,
    ] = await Promise.all([
      this.prisma.division.findMany({ where: { eventId: event.id } }),
      this.prisma.team.findMany({
        where: { eventId: event.id },
        include: { division: true },
      }),
      this.prisma.player.findMany({ where: { eventId: event.id } }),
      this.prisma.divisionResult.findMany({
        where: { eventId: event.id },
        include: { division: true, team: true },
        orderBy: [{ divisionId: "asc" }, { placement: "asc" }],
      }),
      this.prisma.programWatchlist.findMany({ where: { active: true } }),
      this.prisma.programAlias.findMany(),
      this.prisma.programTeamMatch.findMany({
        where: { active: true, team: { eventId: event.id } },
      }),
      this.prisma.game.findMany({
        where: { eventId: event.id },
        orderBy: { startsAt: "asc" },
      }),
      this.prisma.gameChangeEvent.findMany({
        where: { game: { eventId: event.id } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.prisma.syncRun.findMany({
        where: { eventId: event.id },
        orderBy: { startedAt: "desc" },
        take: 20,
      }),
    ]);
    const playerNamesByTeam = groupPlayerNamesByTeam(
      players.map(prismaPlayerToCore),
    );
    const followerCounts = teamFollowerCounts(
      programs,
      matches.map(prismaMatchToCore),
    );
    const followedTeamIds = new Set(
      matches
        .filter(
          (match) =>
            match.active &&
            match.programWatchlistId === SELECTED_TEAMS_PROGRAM_ID,
        )
        .map((match) => match.teamId),
    );

    return {
      event: {
        ...prismaEventToCore(
          event,
          tournament,
          teams.length,
          event.lastSyncedAt?.toISOString() ?? null,
        ),
        slug: tournament.slug,
        timezone: tournament.timezone,
      },
      events: await this.events(),
      divisions: divisions.map((division) => ({
        id: division.id,
        eventId: division.eventId,
        exposureDivisionId: division.exposureDivisionId,
        name: division.name,
        gender: division.gender,
        gradeLevel: division.gradeLevel,
        level: division.level,
        rawJson: division.rawJson,
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
        city: team.city,
        state: team.state,
        sourceUrl: team.sourceUrl,
        divisionName: team.division?.name ?? null,
        gender: team.division?.gender ?? null,
        gradeLevel: team.division?.gradeLevel ?? null,
        level: team.division?.level ?? null,
        rawJson: team.rawJson,
        lastSeenAt: team.lastSeenAt.toISOString(),
        createdAt: team.createdAt.toISOString(),
        updatedAt: team.updatedAt.toISOString(),
        playerNames: playerNamesByTeam.get(team.id) ?? [],
        isFollowed: followedTeamIds.has(team.id),
        followerCount: followerCounts.get(team.id) ?? 0,
      })),
      players: players.map(prismaPlayerToCore),
      divisionResults: divisionResults.map((result) => ({
        id: result.id,
        eventId: result.eventId,
        divisionId: result.divisionId,
        divisionName: result.division.name,
        gender: result.division.gender,
        gradeLevel: result.division.gradeLevel,
        level: result.division.level,
        teamId: result.teamId,
        teamNameSnapshot: result.teamNameSnapshot,
        teamSourceUrl: result.team?.sourceUrl ?? null,
        placement: result.placement as ResultPlacement,
        medalLabel: result.medalLabel as ResultMedalLabel,
        bracketLabel: result.bracketLabel,
        source: result.source as ResultSource,
        sourceUrl: result.sourceUrl,
        isOfficial: result.isOfficial,
        sourceHash: result.sourceHash,
        rawJson: result.rawJson,
        lastSeenAt: result.lastSeenAt.toISOString(),
      })),
      programs: programs.map((program) => ({
        id: program.id,
        userId: program.userId,
        programName: program.programName,
        normalizedProgramName: program.normalizedProgramName,
        active: program.active,
        createdAt: program.createdAt.toISOString(),
      })),
      aliases: aliases.map((alias) => ({
        id: alias.id,
        programWatchlistId: alias.programWatchlistId,
        alias: alias.alias,
        normalizedAlias: alias.normalizedAlias,
        createdAt: alias.createdAt.toISOString(),
      })),
      matches: matches.map((match) => ({
        id: match.id,
        programWatchlistId: match.programWatchlistId,
        teamId: match.teamId,
        matchType: match.matchType as MatchType,
        matchConfidence: Number(match.matchConfidence),
        active: match.active,
        createdAt: match.createdAt.toISOString(),
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
        homeScore: sanitizeBasketballScore(game.homeScore),
        awayScore: sanitizeBasketballScore(game.awayScore),
        status: game.status as Game["status"],
        officialUrl: game.officialUrl,
        streamingUrl: game.streamingUrl,
        updatedAt: game.updatedAt.toISOString(),
        sourceHash: game.sourceHash,
        rawJson: game.rawJson,
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
        errorMessage: run.errorMessage,
      })),
    };
  }

  async syncStatus(
    exposureEventId?: number | null,
    scope: "event" | "all" = "event",
  ): Promise<SyncStatus> {
    if (scope === "all") {
      const [aggregate, latestChange, latestSuccess] = await Promise.all([
        this.prisma.event.aggregate({
          _max: {
            lastSyncedAt: true,
            lastCheckedAt: true,
            lastTeamChangeAt: true,
          },
        }),
        this.prisma.gameChangeEvent.findFirst({
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        this.prisma.syncRun.findFirst({
          where: { status: "success", completedAt: { not: null } },
          orderBy: { completedAt: "desc" },
          select: { completedAt: true },
        }),
      ]);
      const lastSyncedAt = aggregate._max.lastSyncedAt?.toISOString() ?? null;
      const lastCheckedAt = aggregate._max.lastCheckedAt?.toISOString() ?? null;
      const lastTeamChangeAt =
        aggregate._max.lastTeamChangeAt?.toISOString() ?? null;
      const latestChangeAt = latestChange?.createdAt.toISOString() ?? null;
      const latestSuccessfulSyncAt =
        latestSuccess?.completedAt?.toISOString() ?? lastSyncedAt;

      return {
        scope,
        exposureEventId: null,
        lastSyncedAt,
        lastCheckedAt,
        lastTeamChangeAt,
        latestChangeAt,
        latestSuccessfulSyncAt,
        fingerprint: [
          scope,
          lastSyncedAt ?? "",
          lastCheckedAt ?? "",
          lastTeamChangeAt ?? "",
          latestChangeAt ?? "",
          latestSuccessfulSyncAt ?? "",
        ].join("|"),
      };
    }

    const requestedTournament = tournamentForExposureEventId(exposureEventId);
    const event = await this.prisma.event.findUnique({
      where: { exposureEventId: requestedTournament.exposureEventId },
    });

    if (!event) {
      return {
        scope,
        exposureEventId: requestedTournament.exposureEventId,
        lastSyncedAt: null,
        lastCheckedAt: null,
        lastTeamChangeAt: null,
        latestChangeAt: null,
        latestSuccessfulSyncAt: null,
        fingerprint: `${requestedTournament.exposureEventId}|pending`,
      };
    }

    const [latestChange, latestSuccess] = await Promise.all([
      this.prisma.gameChangeEvent.findFirst({
        where: { game: { eventId: event.id } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      this.prisma.syncRun.findFirst({
        where: {
          eventId: event.id,
          status: "success",
          completedAt: { not: null },
        },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true },
      }),
    ]);
    const lastSyncedAt = event.lastSyncedAt?.toISOString() ?? null;
    const lastCheckedAt = event.lastCheckedAt?.toISOString() ?? null;
    const lastTeamChangeAt = event.lastTeamChangeAt?.toISOString() ?? null;
    const latestChangeAt = latestChange?.createdAt.toISOString() ?? null;
    const latestSuccessfulSyncAt =
      latestSuccess?.completedAt?.toISOString() ?? lastSyncedAt;

    return {
      scope,
      exposureEventId: event.exposureEventId,
      lastSyncedAt,
      lastCheckedAt,
      lastTeamChangeAt,
      latestChangeAt,
      latestSuccessfulSyncAt,
      fingerprint: [
        event.exposureEventId,
        lastSyncedAt ?? "",
        lastTeamChangeAt ?? "",
        latestChangeAt ?? "",
        latestSuccessfulSyncAt ?? "",
      ].join("|"),
    };
  }

  async dashboard(clientId?: string | null, exposureEventId?: number | null) {
    return buildDashboard(
      await this.snapshotForClient(clientId, exposureEventId),
      new Date(),
      { includeEvents: false, includePointsLeaders: false },
    );
  }

  async program(
    programId: string,
    clientId?: string | null,
    exposureEventId?: number | null,
  ) {
    return (
      (await this.dashboard(clientId, exposureEventId)).programs.find(
        (program) => program.program.id === programId,
      ) ?? null
    );
  }

  async games(
    filters: Record<string, string | undefined>,
    clientId?: string | null,
    exposureEventId?: number | null,
  ) {
    return new ScheduleService().listWatchedGames(
      await this.snapshotForClient(clientId, exposureEventId),
      {
        programId: filters.programId,
        status: filters.status,
        court: filters.court,
        division: filters.division,
        scope: filters.scope,
      },
    );
  }

  async courts(exposureEventId?: number | null) {
    return new CourtFinderService().listCourts(
      await this.snapshot(exposureEventId),
    );
  }

  async game(gameId: string) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) return null;
    const changeEvents = await this.prisma.gameChangeEvent.findMany({
      where: { gameId },
      orderBy: { createdAt: "desc" },
    });
    return {
      ...withEffectiveGameStatus(prismaGameToCore(game)),
      changeHistory: changeEvents.map(toCoreChange),
    };
  }

  async teams(
    search?: string,
    clientId?: string | null,
    exposureEventId?: number | null,
    allEvents = false,
    limit?: number,
  ) {
    if (allEvents) return this.teamsAcrossEvents(search, clientId, limit);
    await this.hydratePublishedTeamsIfMissing(exposureEventId);
    await this.hydrateActiveGamesIfStale(exposureEventId);
    const snapshot = await this.teamsSnapshotForEvent(
      clientId,
      exposureEventId,
    );
    const normalized = normalizeName(search);
    return filterTeamsForSearch(snapshot, normalized);
  }

  private async teamsAcrossEvents(
    search?: string,
    clientId?: string | null,
    limit?: number,
  ): Promise<Team[]> {
    const program = await this.ensureSelectedProgram(clientId);
    const normalized = normalizeName(search);
    const teamWhere = allEventsTeamSearchWhere(search);
    const teams = await this.prisma.team.findMany({
      where: teamWhere,
      include: { division: true, event: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...(typeof limit === "number" ? { take: limit } : {}),
    });
    const teamIds = teams.map((team) => team.id);
    const [programs, matches, games] = await Promise.all([
      this.prisma.programWatchlist.findMany({ where: { active: true } }),
      this.prisma.programTeamMatch.findMany({ where: { active: true } }),
      teamIds.length > 0
        ? this.prisma.game.findMany({
            where: {
              OR: [
                { homeTeamId: { in: teamIds } },
                { awayTeamId: { in: teamIds } },
              ],
            },
            orderBy: { startsAt: "asc" },
          })
        : Promise.resolve([]),
    ]);
    const followerCounts = teamFollowerCounts(
      programs,
      matches.map(prismaMatchToCore),
    );
    const followedTeamIds = new Set(
      matches
        .filter(
          (match) => match.active && match.programWatchlistId === program.id,
        )
        .map((match) => match.teamId),
    );
    const coreTeams: Team[] = teams.map((team) => ({
      id: team.id,
      eventId: team.eventId,
      divisionId: team.divisionId,
      exposureTeamId: team.exposureTeamId,
      name: team.name,
      normalizedName: team.normalizedName,
      clubName: team.clubName,
      normalizedClubName: team.normalizedClubName,
      coachName: team.coachName,
      city: team.city,
      state: team.state,
      sourceUrl: team.sourceUrl,
      divisionName: team.division?.name ?? null,
      gender: team.division?.gender ?? null,
      gradeLevel: team.division?.gradeLevel ?? null,
      level: team.division?.level ?? null,
      rawJson: team.rawJson,
      lastSeenAt: team.lastSeenAt.toISOString(),
      createdAt: team.createdAt.toISOString(),
      updatedAt: team.updatedAt.toISOString(),
      exposureEventId: team.event.exposureEventId,
      eventName: team.event.name,
      eventLocation: team.event.location,
      playerNames: [],
      isFollowed: followedTeamIds.has(team.id),
      followerCount: followerCounts.get(team.id) ?? 0,
    }));
    const recordSnapshot = {
      teams: coreTeams,
      games: games.map(prismaGameToCore),
      programs: programs.map((item) => ({
        id: item.id,
        userId: item.userId,
        programName: item.programName,
        normalizedProgramName: item.normalizedProgramName,
        active: item.active,
        createdAt: item.createdAt.toISOString(),
      })),
      matches: matches.map(prismaMatchToCore),
    } as CourtWatchSnapshot;
    return filterTeamsForSearch(recordSnapshot, normalized).map((team) => ({
      ...team,
      isFollowed: followedTeamIds.has(team.id),
    }));
  }

  async favoriteTeamWatches(
    clientId?: string | null,
  ): Promise<FavoriteTeamWatch[]> {
    const ownerHash = favoriteWatchOwnerHash(clientId);
    const watches = await this.prisma.favoriteTeamWatch.findMany({
      where: { ownerHash, active: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return watches.map(prismaFavoriteTeamWatchToCore);
  }

  async saveFavoriteTeamWatch(
    input: FavoriteTeamWatchInput,
    clientId?: string | null,
  ): Promise<FavoriteTeamWatch> {
    const ownerHash = favoriteWatchOwnerHash(clientId);
    const displayName = input.displayName.trim();
    const normalizedName = normalizeName(displayName);
    const sourceTeamId = input.sourceTeamId?.trim() || null;
    const existing = await this.prisma.favoriteTeamWatch.findFirst({
      where: {
        ownerHash,
        normalizedName,
        sourceTeamId,
      },
    });
    const data = {
      displayName,
      normalizedName,
      source: sourceTeamId ? "registered" : "custom",
      sourceTeamId,
      sourceTeamName: input.sourceTeamName ?? null,
      eventName: input.eventName ?? null,
      divisionName: input.divisionName ?? null,
      gender: input.gender ?? null,
      gradeLevel: input.gradeLevel ?? null,
      level: input.level ?? null,
      active: true,
    };
    const watch = existing
      ? await this.prisma.favoriteTeamWatch.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.favoriteTeamWatch.create({
          data: { ownerHash, ...data },
        });
    return prismaFavoriteTeamWatchToCore(watch);
  }

  async deleteFavoriteTeamWatch(
    watchId: string,
    clientId?: string | null,
  ): Promise<void> {
    const ownerHash = favoriteWatchOwnerHash(clientId);
    await this.prisma.favoriteTeamWatch.updateMany({
      where: { id: watchId, ownerHash },
      data: { active: false },
    });
  }

  async scoringLeaders(
    clientId?: string | null,
    exposureEventId?: number | null,
  ) {
    const snapshot = await this.snapshotForClient(clientId, exposureEventId);
    return buildTeamScoringLeaders(snapshot.games, snapshot.teams, {
      includeUnscoredTeams: true,
    });
  }

  async results(
    clientId?: string | null,
    scope: "watched" | "all" = "watched",
    exposureEventId?: number | null,
  ) {
    return buildDivisionResultGroups(
      await this.snapshotForClient(clientId, exposureEventId),
      { scope },
    );
  }

  async team(teamId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { division: true },
    });
    if (!team) return null;
    return {
      id: team.id,
      eventId: team.eventId,
      divisionId: team.divisionId,
      exposureTeamId: team.exposureTeamId,
      name: team.name,
      normalizedName: team.normalizedName,
      clubName: team.clubName,
      normalizedClubName: team.normalizedClubName,
      coachName: team.coachName,
      city: team.city,
      state: team.state,
      sourceUrl: team.sourceUrl,
      divisionName: team.division?.name ?? null,
      gender: team.division?.gender ?? null,
      gradeLevel: team.division?.gradeLevel ?? null,
      level: team.division?.level ?? null,
      rawJson: team.rawJson,
      lastSeenAt: team.lastSeenAt.toISOString(),
      createdAt: team.createdAt.toISOString(),
      updatedAt: team.updatedAt.toISOString(),
    };
  }

  async alerts(clientId?: string | null, exposureEventId?: number | null) {
    const snapshot = await this.snapshotForClient(clientId, exposureEventId);
    const activeProgramIds = new Set(
      snapshot.programs.map((program) => program.id),
    );
    const watchedTeamIds = new Set(
      snapshot.matches
        .filter(
          (match) =>
            match.active && activeProgramIds.has(match.programWatchlistId),
        )
        .map((match) => match.teamId),
    );
    const watchedGameIds = new Set(
      snapshot.games
        .filter(
          (game) =>
            watchedTeamIds.has(game.homeTeamId ?? "") ||
            watchedTeamIds.has(game.awayTeamId ?? ""),
        )
        .map((game) => game.id),
    );
    return watchedAlertsForSnapshot(
      snapshot,
      watchedTeamIds,
      watchedGameIds,
      activeProgramIds,
    );
  }

  async followTeam(teamId: string, clientId?: string | null) {
    const program = await this.ensureSelectedProgram(clientId);
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new Error("Team not found");
    const match = await this.prisma.programTeamMatch.upsert({
      where: {
        programWatchlistId_teamId: { programWatchlistId: program.id, teamId },
      },
      update: { active: true, matchType: "manual", matchConfidence: 1 },
      create: {
        programWatchlistId: program.id,
        teamId,
        matchType: "manual",
        matchConfidence: 1,
      },
    });
    return prismaMatchToCore(match);
  }

  async unfollowTeam(teamId: string, clientId?: string | null) {
    const program = await this.ensureSelectedProgram(clientId);
    await this.prisma.programTeamMatch.updateMany({
      where: { programWatchlistId: program.id, teamId },
      data: { active: false },
    });
  }

  async addAlias(programId: string, aliasValue: string) {
    const alias = await this.prisma.programAlias.upsert({
      where: {
        programWatchlistId_normalizedAlias: {
          programWatchlistId: programId,
          normalizedAlias: normalizeProgramName(aliasValue),
        },
      },
      update: { alias: aliasValue },
      create: {
        programWatchlistId: programId,
        alias: aliasValue,
        normalizedAlias: normalizeProgramName(aliasValue),
      },
    });
    return {
      id: alias.id,
      programWatchlistId: alias.programWatchlistId,
      alias: alias.alias,
      normalizedAlias: alias.normalizedAlias,
      createdAt: alias.createdAt.toISOString(),
    };
  }

  async deleteAlias(programId: string, aliasId: string) {
    await this.prisma.programAlias.deleteMany({
      where: { id: aliasId, programWatchlistId: programId },
    });
  }

  async syncNow(exposureEventId?: number | null) {
    invalidateEventsCache();
    await this.markCompletedEvents();
    const tournaments = await this.syncTournamentTargets(exposureEventId);
    const results = [];
    for (const tournament of tournaments) {
      try {
        results.push(await this.syncTournament(tournament));
      } catch (error) {
        if (exposureEventId) throw error;
        console.warn("Tournament sync skipped", {
          exposureEventId: tournament.exposureEventId,
          name: tournament.name,
          error: error instanceof Error ? error.message : "Unknown sync error",
        });
        results.push({
          status: "failed",
          source: syncSourceForTournament(tournament),
          teamsCount: 0,
          gamesCount: 0,
          changesDetected: 0,
        });
      }
    }
    invalidateEventsCache();
    return aggregateSyncResults(results);
  }

  async discoverTournaments() {
    invalidateEventsCache();
    await this.markCompletedEvents();
    const result = await new TournamentDiscoveryService().discover(
      majorTournamentSources(),
      { windowDays: config.TOURNAMENT_DISCOVERY_WINDOW_DAYS },
    );
    const syncResults = [];
    for (const candidate of result.candidates) {
      if (isMetadataOnlyTournamentCandidate(candidate)) {
        await upsertEvent(this.prisma, candidate.event);
        syncResults.push({
          status: "success",
          source: "directory",
          teamsCount: 0,
          gamesCount: 0,
          changesDetected: 0,
        });
      } else {
        syncResults.push(
          await this.syncTournament(candidate.event, candidate.teams),
        );
      }
    }
    for (const failure of result.failures) {
      console.warn("Tournament discovery source skipped", failure);
    }
    const response = {
      status: syncResults.every((item) => item.status === "success")
        ? "success"
        : "failed",
      discoveredCount: result.candidates.length,
      syncedCount: syncResults.length,
      failures: result.failures,
    };
    invalidateEventsCache();
    return response;
  }

  private async syncTournamentTargets(
    exposureEventId?: number | null,
  ): Promise<TournamentSource[]> {
    if (exposureEventId)
      return [await this.tournamentSourceForSync(exposureEventId)];

    const byExposureId = new Map<number, TournamentSource>();
    for (const tournament of configuredTournaments().filter(
      isCourtWatchSupportedTournamentRegion,
    )) {
      byExposureId.set(tournament.exposureEventId, tournament);
    }
    const eventsWithTeams = await this.eventsWithStoredTeamData();
    for (const event of eventsWithTeams) {
      if (!byExposureId.has(event.exposureEventId)) {
        byExposureId.set(event.exposureEventId, event);
      }
    }
    const eventsNeedingTeams = await this.eventsNeedingTeamHydration();
    for (const event of eventsNeedingTeams) {
      if (!byExposureId.has(event.exposureEventId)) {
        byExposureId.set(event.exposureEventId, event);
      }
    }
    return sortTournamentEvents(Array.from(byExposureId.values()));
  }

  private async trackedExposureEventIdsForClient(
    clientId?: string | null,
  ): Promise<Set<number>> {
    if (!clientId) return new Set();
    const program = await this.ensureSelectedProgram(clientId);
    const matches = await this.prisma.programTeamMatch.findMany({
      where: { active: true, programWatchlistId: program.id },
      select: {
        team: {
          select: {
            event: { select: { exposureEventId: true } },
          },
        },
      },
    });
    return new Set(matches.map((match) => match.team.event.exposureEventId));
  }

  private async eventsWithStoredTeamData(): Promise<TournamentEvent[]> {
    const scopedEvents = await this.prisma.event.findMany({
      where: courtWatchEventScopeWhere(),
      orderBy: [{ startDate: "asc" }, { name: "asc" }],
    });
    const scopedEventIds = scopedEvents.map((event) => event.id);
    const [teamCounts, latestSuccesses] = await Promise.all([
      this.prisma.team.groupBy({
        by: ["eventId"],
        where: { eventId: { in: scopedEventIds } },
        _count: { _all: true },
      }),
      this.prisma.syncRun.groupBy({
        by: ["eventId"],
        where: {
          eventId: { in: scopedEventIds },
          status: "success",
          completedAt: { not: null },
        },
        _max: { completedAt: true },
      }),
    ]);
    const eventIdsWithTeams = new Set(
      teamCounts
        .filter((count) => count._count._all > 0)
        .map((count) => count.eventId),
    );
    const eventIds = [...eventIdsWithTeams];
    if (eventIds.length === 0) return [];

    const teamCountByEventId = new Map(
      teamCounts.map((count) => [count.eventId, count._count._all]),
    );
    const latestSuccessByEventId = new Map(
      latestSuccesses.map((run) => [
        run.eventId,
        run._max.completedAt?.toISOString() ?? null,
      ]),
    );
    return scopedEvents
      .filter((event) => eventIdsWithTeams.has(event.id))
      .map((event) =>
        prismaEventToCore(
          event,
          undefined,
          teamCountByEventId.get(event.id),
          latestSuccessByEventId.get(event.id) ?? null,
        ),
      )
      .filter(isCourtWatchSupportedTournamentRegion);
  }

  private async eventsNeedingTeamHydration(): Promise<TournamentEvent[]> {
    const todayKey = tournamentTodayKey();
    const windowEndKey = tournamentWindowEndKey(
      todayKey,
      config.TOURNAMENT_DISCOVERY_WINDOW_DAYS,
    );
    const events = await this.prisma.event.findMany({
      where: courtWatchScopedEventWhere({
        externalProvider: "exposure_events",
        hasPublicTeamList: true,
        registeredTeamCount: { gt: 0 },
        startDate: { lte: new Date(`${windowEndKey}T00:00:00.000Z`) },
        endDate: { gte: new Date(`${todayKey}T00:00:00.000Z`) },
        status: { notIn: ["cancelled", "unavailable"] },
      }),
      orderBy: [{ startDate: "asc" }, { name: "asc" }],
    });
    const eventIds = events.map((event) => event.id);
    const [teamCounts, latestSuccesses] = await Promise.all([
      this.prisma.team.groupBy({
        by: ["eventId"],
        where: { eventId: { in: eventIds } },
        _count: { _all: true },
      }),
      this.prisma.syncRun.groupBy({
        by: ["eventId"],
        where: {
          eventId: { in: eventIds },
          status: "success",
          completedAt: { not: null },
        },
        _max: { completedAt: true },
      }),
    ]);
    const teamCountByEventId = new Map(
      teamCounts.map((count) => [count.eventId, count._count._all]),
    );
    const latestSuccessByEventId = new Map(
      latestSuccesses.map((run) => [
        run.eventId,
        run._max.completedAt?.toISOString() ?? null,
      ]),
    );
    return events
      .filter((event) => {
        const storedTeams = teamCountByEventId.get(event.id) ?? 0;
        return storedTeams < event.registeredTeamCount;
      })
      .map((event) =>
        prismaEventToCore(
          event,
          undefined,
          teamCountByEventId.get(event.id) ?? null,
          latestSuccessByEventId.get(event.id) ?? null,
        ),
      )
      .filter(isCourtWatchSupportedTournamentRegion);
  }

  private async tournamentSourceForSync(
    exposureEventId: number,
  ): Promise<TournamentSource> {
    const configured = configuredTournaments().find(
      (event) => event.exposureEventId === exposureEventId,
    );
    if (configured) return configured;

    const event = await this.prisma.event.findUnique({
      where: { exposureEventId },
    });
    if (event) return prismaEventToCore(event);

    return tournamentForExposureEventId(exposureEventId);
  }

  private async markCompletedEvents() {
    const today = process.env.COURTWATCH_TODAY
      ? new Date(`${process.env.COURTWATCH_TODAY}T00:00:00.000Z`)
      : new Date();
    await this.prisma.event.updateMany({
      where: {
        endDate: { lt: today },
        status: { notIn: ["completed", "cancelled"] },
      },
      data: { status: "completed" },
    });
  }

  private async syncTournament(
    tournament: TournamentSource,
    preloadedTeams?: PublicTournamentCandidate["teams"],
  ) {
    const startedAt = new Date();
    const source =
      tournament.externalProvider === "exposure_events" &&
      isExposureConfigured()
        ? "exposure_api"
        : "public_page";
    let teamsCount = 0;
    let gamesCount = 0;
    let changesDetected = 0;

    const event = await upsertEvent(this.prisma, tournament);
    const run = await this.prisma.syncRun.create({
      data: {
        eventId: event.id,
        startedAt,
        status: "running",
        source,
        teamsCount: 0,
        gamesCount: 0,
        changesDetected: 0,
      },
    });

    try {
      const sourceTeams = dedupeSourceTeams(
        preloadedTeams ?? (await fetchSourceTeams(tournament)),
      );
      const mockDataEnabled = process.env.ENABLE_MOCK_DATA === "true";
      const includeMockArsenal = process.env.ENABLE_MOCK_ARSENAL === "true";
      const usingMockFallback =
        mockDataEnabled && sourceTeams.teams.length === 0;
      await ensurePrograms(this.prisma);
      const previousTeamIds = await loadEventTeamExternalIds(
        this.prisma,
        event.id,
      );
      if (usingMockFallback) {
        await upsertSeedDivisionsTeamsAndGames(
          this.prisma,
          event.id,
          includeMockArsenal,
        );
      } else {
        await removeSeedGameAndChangeData(this.prisma);
        if (!includeMockArsenal) await removeMockArsenalSeedData(this.prisma);
      }

      const divisionIdMap = await upsertSourceDivisionsAndTeams(
        this.prisma,
        event.id,
        sourceTeams,
      );
      if (!usingMockFallback && sourceTeams.teams.length > 0)
        await removeTeamsMissingFromPublicList(
          this.prisma,
          event.id,
          sourceTeams.teams,
        );

      const teamMap = await loadTeamMap(this.prisma, event.id);
      const sourcePlayers = await fetchSourcePlayers(
        event.id,
        teamMap,
        tournament,
      );
      for (const player of sourcePlayers) {
        await upsertPlayer(this.prisma, event.id, player);
      }

      const selectedDivisionIds = await loadSelectedDivisionExposureIds(
        this.prisma,
        event.id,
      );
      const sourceGames = await fetchSourceGames(
        selectedDivisionIds,
        tournament,
      );
      for (const sourceGame of sourceGames) {
        const mapped = isCoreGame(sourceGame)
          ? mapStoredSourceGame(sourceGame, event.id, teamMap, divisionIdMap)
          : mapExposureGame(
              sourceGame,
              event.id,
              teamMap,
              tournament,
              divisionIdMap,
            );
        if (!mapped) continue;
        const existing = mapped.exposureGameId
          ? await this.prisma.game.findUnique({
              where: {
                eventId_exposureGameId: {
                  eventId: event.id,
                  exposureGameId: mapped.exposureGameId,
                },
              },
            })
          : null;
        const previousGame = existing ? prismaGameToCore(existing) : null;
        const changes = detectGameChanges(previousGame, mapped);
        changesDetected += changes.length;
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
              dedupeKey: change.dedupeKey,
            },
          });
        }
      }

      const resultSnapshot = await this.snapshot(tournament.exposureEventId);
      const derivedDivisionResults =
        deriveDivisionResultsFromGames(resultSnapshot);
      const sourceDivisionResults = await fetchSourceDivisionResults(
        this.prisma,
        tournament,
        event.id,
        teamMap,
        divisionIdMap,
      );
      const divisionResults = [
        ...derivedDivisionResults,
        ...sourceDivisionResults.results,
      ];
      if (sourceDivisionResults.fetched) {
        await replaceDivisionResultsForEvent(
          this.prisma,
          event.id,
          divisionResults,
        );
      } else {
        for (const result of divisionResults) {
          await upsertDivisionResult(this.prisma, result);
        }
      }

      const after = await this.snapshot(tournament.exposureEventId);
      teamsCount = after.teams.length;
      gamesCount = after.games.length;
      const syncedAt = new Date();
      const publicTeamListWasFetched =
        sourceTeams.teams.length > 0 ||
        (Boolean(preloadedTeams) && tournament.hasPublicTeamList);
      await this.prisma.event.update({
        where: { id: event.id },
        data: {
          registeredTeamCount: publicTeamListWasFetched
            ? teamsCount
            : tournament.registeredTeamCount,
          hasPublicTeamList:
            publicTeamListWasFetched || tournament.hasPublicTeamList,
          lastCheckedAt: syncedAt,
          lastSyncedAt:
            publicTeamListWasFetched || gamesCount > 0 ? syncedAt : undefined,
          lastTeamChangeAt: haveTeamExternalIdsChanged(
            previousTeamIds,
            sourceTeams.teams,
          )
            ? syncedAt
            : undefined,
          status: deriveTournamentStatus({
            startDate: tournament.startDate,
            endDate: tournament.endDate,
            status: tournament.status,
          }),
        },
      });
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          completedAt: new Date(),
          teamsCount,
          gamesCount,
          changesDetected,
        },
      });

      return {
        status: "success",
        source,
        teamsCount,
        gamesCount,
        changesDetected,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown sync error";
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          teamsCount,
          gamesCount,
          changesDetected,
          errorMessage,
        },
      });
      await this.prisma.event.update({
        where: { id: event.id },
        data: {
          lastCheckedAt: new Date(),
          status: syncFailureStatus(tournament, errorMessage),
        },
      });
      throw error;
    }
  }

  private async snapshotForClient(
    clientId?: string | null,
    exposureEventId?: number | null,
  ): Promise<CourtWatchSnapshot> {
    await this.hydrateActiveGamesIfStale(exposureEventId);
    const program = await this.ensureSelectedProgram(clientId);
    return scopeSnapshot(await this.snapshot(exposureEventId), program.id);
  }

  private async teamsSnapshotForEvent(
    clientId?: string | null,
    exposureEventId?: number | null,
  ): Promise<CourtWatchSnapshot> {
    const requestedTournament = tournamentForExposureEventId(exposureEventId);
    const event = await this.prisma.event.findUnique({
      where: { exposureEventId: requestedTournament.exposureEventId },
    });
    if (!event) {
      return scopeSnapshot(
        emptySnapshotForTournament(requestedTournament, []),
        (await this.ensureSelectedProgram(clientId)).id,
      );
    }

    const tournament =
      configuredTournaments().find(
        (source) => source.exposureEventId === event.exposureEventId,
      ) ?? prismaEventToCore(event);
    const [teams, games, programs, matches] = await Promise.all([
      this.prisma.team.findMany({
        where: { eventId: event.id },
        include: { division: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      this.prisma.game.findMany({
        where: { eventId: event.id },
        orderBy: { startsAt: "asc" },
      }),
      this.prisma.programWatchlist.findMany({ where: { active: true } }),
      this.prisma.programTeamMatch.findMany({
        where: { active: true, team: { eventId: event.id } },
      }),
    ]);
    const followerCounts = teamFollowerCounts(
      programs.map(prismaProgramToCore),
      matches.map(prismaMatchToCore),
    );
    const followedProgram = await this.ensureSelectedProgram(clientId);
    const followedTeamIds = new Set(
      matches
        .filter(
          (match) =>
            match.active && match.programWatchlistId === followedProgram.id,
        )
        .map((match) => match.teamId),
    );
    const snapshot: CourtWatchSnapshot = {
      event: {
        ...prismaEventToCore(
          event,
          tournament,
          teams.length,
          event.lastSyncedAt?.toISOString() ?? null,
        ),
        slug: tournament.slug,
        timezone: tournament.timezone,
      },
      events: [],
      divisions: [],
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
        city: team.city,
        state: team.state,
        sourceUrl: team.sourceUrl,
        divisionName: team.division?.name ?? null,
        gender: team.division?.gender ?? null,
        gradeLevel: team.division?.gradeLevel ?? null,
        level: team.division?.level ?? null,
        rawJson: team.rawJson,
        lastSeenAt: team.lastSeenAt.toISOString(),
        createdAt: team.createdAt.toISOString(),
        updatedAt: team.updatedAt.toISOString(),
        playerNames: [],
        isFollowed: followedTeamIds.has(team.id),
        followerCount: followerCounts.get(team.id) ?? 0,
      })),
      players: [],
      divisionResults: [],
      programs: programs.map(prismaProgramToCore),
      aliases: [],
      matches: matches.map(prismaMatchToCore),
      games: games.map(prismaGameToCore),
      changeEvents: [],
      syncRuns: [],
    };
    return scopeSnapshot(snapshot, followedProgram.id);
  }

  private async hydratePublishedTeamsIfMissing(
    exposureEventId?: number | null,
  ) {
    if (!exposureEventId) return;
    const event = await this.prisma.event.findUnique({
      where: { exposureEventId },
    });
    if (!event) return;
    const storedTeams = await this.prisma.team.count({
      where: { eventId: event.id },
    });
    const shouldRefreshEmptyPublishedList = shouldRecheckPublicTeamList(
      event,
      storedTeams,
    );
    if (storedTeams >= event.registeredTeamCount && storedTeams > 0) {
      if (
        !event.lastSyncedAt ||
        !event.hasPublicTeamList ||
        event.registeredTeamCount !== storedTeams
      ) {
        const now = new Date();
        await this.prisma.event.update({
          where: { id: event.id },
          data: {
            registeredTeamCount: storedTeams,
            hasPublicTeamList: true,
            lastCheckedAt: now,
            lastSyncedAt: now,
          },
        });
      }
      return;
    }
    if (
      !event.hasPublicTeamList &&
      event.registeredTeamCount <= 0 &&
      !shouldRefreshEmptyPublishedList
    )
      return;

    const tournament =
      configuredTournaments().find(
        (source) => source.exposureEventId === event.exposureEventId,
      ) ?? prismaEventToCore(event);
    if (!isExposureEvent(tournament)) return;

    try {
      const sourceTeams = dedupeSourceTeams(await fetchSourceTeams(tournament));
      if (sourceTeams.teams.length === 0) {
        await this.prisma.event.update({
          where: { id: event.id },
          data: { lastCheckedAt: new Date() },
        });
        invalidateEventsCache();
        return;
      }
      const teamListChanged = sourceTeams.teams.length !== storedTeams;
      const syncedAt = new Date();
      await upsertSourceDivisionsAndTeams(this.prisma, event.id, sourceTeams);
      await this.prisma.event.update({
        where: { id: event.id },
        data: {
          registeredTeamCount: sourceTeams.teams.length,
          hasPublicTeamList: true,
          lastCheckedAt: syncedAt,
          lastSyncedAt: syncedAt,
          lastTeamChangeAt: teamListChanged ? syncedAt : undefined,
        },
      });
      invalidateEventsCache();
    } catch (error) {
      console.warn("Unable to hydrate published team list", {
        exposureEventId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  private async hydrateActiveGamesIfStale(exposureEventId?: number | null) {
    const requestedTournament = tournamentForExposureEventId(exposureEventId);
    const event = await this.prisma.event.findUnique({
      where: { exposureEventId: requestedTournament.exposureEventId },
    });
    if (!event || !isExposureEvent(prismaEventToCore(event))) return;

    const tournament =
      configuredTournaments().find(
        (source) => source.exposureEventId === event.exposureEventId,
      ) ?? prismaEventToCore(event);
    if (!isExposureEvent(tournament)) return;
    if (event.status === "cancelled") return;
    if (
      event.status === "completed" &&
      !isRecentlyCompletedTournament(tournament)
    ) {
      return;
    }
    const selectedDivisionIds = await loadSelectedDivisionExposureIds(
      this.prisma,
      event.id,
    );
    const tournamentStarted = hasTournamentStarted(tournament);
    if (!tournamentStarted && selectedDivisionIds.length === 0) return;
    if (!event.hasPublicTeamList && event.registeredTeamCount <= 0) return;

    const selectedDivisionDbIds =
      !tournamentStarted && selectedDivisionIds.length > 0
        ? await this.prisma.division.findMany({
            where: {
              eventId: event.id,
              exposureDivisionId: { in: selectedDivisionIds },
            },
            select: { id: true },
          })
        : [];
    const gameHydrationWhere =
      selectedDivisionDbIds.length > 0
        ? {
            eventId: event.id,
            divisionId: {
              in: selectedDivisionDbIds.map((division) => division.id),
            },
          }
        : { eventId: event.id };

    const [storedGames, latestGame] = await Promise.all([
      this.prisma.game.count({ where: gameHydrationWhere }),
      this.prisma.game.findFirst({
        where: gameHydrationWhere,
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
    ]);
    const lastDataAt =
      event.lastCheckedAt ?? latestGame?.updatedAt ?? event.lastSyncedAt;
    if (
      storedGames > 0 &&
      lastDataAt &&
      Date.now() - lastDataAt.getTime() < ACTIVE_GAME_HYDRATION_STALE_MS
    ) {
      return;
    }

    const existing = activeGameHydrationPromises.get(event.exposureEventId);
    if (existing) {
      return;
    }

    const promise = this.syncTournament(tournament)
      .then(() => undefined)
      .catch((error) => {
        console.warn("Unable to hydrate active game data", {
          exposureEventId: event.exposureEventId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      })
      .finally(() => {
        activeGameHydrationPromises.delete(event.exposureEventId);
      });
    activeGameHydrationPromises.set(event.exposureEventId, promise);
  }

  private async ensureSelectedProgram(
    clientId?: string | null,
  ): Promise<ProgramWatchlist> {
    if (!clientId) {
      await ensurePrograms(this.prisma);
      return {
        id: SELECTED_TEAMS_PROGRAM_ID,
        userId: null,
        programName: SELECTED_TEAMS_PROGRAM_NAME,
        normalizedProgramName: normalizeProgramName(
          SELECTED_TEAMS_PROGRAM_NAME,
        ),
        active: true,
        createdAt: new Date().toISOString(),
      };
    }

    const user = await ensureUserForClient(this.prisma, clientId);
    const normalizedProgramName = normalizeProgramName(
      SELECTED_TEAMS_PROGRAM_NAME,
    );
    const selectedProgramWhere = {
      userId_normalizedProgramName: { userId: user.id, normalizedProgramName },
    };
    let program;
    try {
      program = await this.prisma.programWatchlist.upsert({
        where: selectedProgramWhere,
        update: {
          programName: SELECTED_TEAMS_PROGRAM_NAME,
          active: true,
        },
        create: {
          userId: user.id,
          programName: SELECTED_TEAMS_PROGRAM_NAME,
          normalizedProgramName,
          active: true,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      program = await this.prisma.programWatchlist.findUnique({
        where: selectedProgramWhere,
      });
      if (!program) throw error;
    }

    return {
      id: program.id,
      userId: program.userId,
      programName: program.programName,
      normalizedProgramName: program.normalizedProgramName,
      active: program.active,
      createdAt: program.createdAt.toISOString(),
    };
  }
}

function snapshotForTournament(
  snapshot: CourtWatchSnapshot,
  exposureEventId?: number | null,
): CourtWatchSnapshot {
  const event = selectSnapshotEvent(snapshot, exposureEventId);
  const teamIds = new Set(
    snapshot.teams
      .filter((team) => team.eventId === event.id)
      .map((team) => team.id),
  );
  const gameIds = new Set(
    snapshot.games
      .filter((game) => game.eventId === event.id)
      .map((game) => game.id),
  );

  return {
    ...snapshot,
    event,
    events: dropdownEventsFromSnapshot(snapshot.events, snapshot.teams),
    divisions: snapshot.divisions.filter(
      (division) => division.eventId === event.id,
    ),
    teams: snapshot.teams.filter((team) => team.eventId === event.id),
    players: snapshot.players.filter((player) => player.eventId === event.id),
    divisionResults: snapshot.divisionResults.filter(
      (result) => result.eventId === event.id,
    ),
    matches: snapshot.matches.filter((match) => teamIds.has(match.teamId)),
    games: snapshot.games.filter((game) => game.eventId === event.id),
    changeEvents: snapshot.changeEvents.filter(
      (change) =>
        (change.gameId ? gameIds.has(change.gameId) : true) &&
        (change.affectedTeamId ? teamIds.has(change.affectedTeamId) : true),
    ),
    syncRuns: snapshot.syncRuns.filter((run) => run.eventId === event.id),
  };
}

function selectSnapshotEvent(
  snapshot: CourtWatchSnapshot,
  exposureEventId?: number | null,
): TournamentEvent {
  if (exposureEventId) {
    const selected = snapshot.events.find(
      (event) => event.exposureEventId === exposureEventId,
    );
    if (selected) return selected;
  }
  return (
    snapshot.events.find(
      (event) => event.exposureEventId === snapshot.event.exposureEventId,
    ) ?? snapshot.event
  );
}

function emptySnapshotForTournament(
  tournament: TournamentSource,
  events: TournamentEvent[],
): CourtWatchSnapshot {
  const event =
    events.find(
      (item) => item.exposureEventId === tournament.exposureEventId,
    ) ?? tournament;
  return {
    event,
    events,
    divisions: [],
    teams: [],
    players: [],
    divisionResults: [],
    programs: seedPrograms,
    aliases: [],
    matches: [],
    games: [],
    changeEvents: [],
    syncRuns: [],
  };
}

function sortTournamentEvents(events: TournamentEvent[]): TournamentEvent[] {
  return [...events].sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) ||
      left.name.localeCompare(right.name),
  );
}

function dropdownEventsFromSnapshot(
  events: TournamentEvent[],
  teams: Team[],
): TournamentEvent[] {
  const teamCounts = new Map<string, number>();
  for (const team of teams)
    teamCounts.set(team.eventId, (teamCounts.get(team.eventId) ?? 0) + 1);
  return dropdownEventsWithUpcomingExposureFallback(
    events.map((event) => ({
      ...event,
      registeredTeamCount: teamCounts.get(event.id) ?? 0,
      hasPublicTeamList: event.hasPublicTeamList,
    })),
  );
}

function dropdownEventsWithUpcomingExposureFallback(
  events: TournamentEvent[],
): TournamentEvent[] {
  const supportedEvents = events.filter(isCourtWatchSupportedTournamentRegion);
  const eligible = eligibleTournamentEvents(supportedEvents, {
    windowDays: config.TOURNAMENT_DISCOVERY_WINDOW_DAYS,
    cacheHours: config.TOURNAMENT_DROPDOWN_CACHE_HOURS,
  });
  const eligibleExposureIds = new Set(
    eligible.map((event) => event.exposureEventId),
  );
  const todayKey = tournamentTodayKey();
  const windowEndKey = tournamentWindowEndKey(
    todayKey,
    config.TOURNAMENT_DISCOVERY_WINDOW_DAYS,
  );
  const upcomingExposureEvents = supportedEvents
    .filter((event) => {
      if (eligibleExposureIds.has(event.exposureEventId)) return false;
      if (!isExposureEvent(event)) return false;
      const status = deriveTournamentStatus(event, todayKey);
      return (
        (status === "upcoming" || status === "active") &&
        event.startDate <= windowEndKey &&
        event.endDate >= todayKey
      );
    })
    .map((event) => ({
      ...event,
      status: deriveTournamentStatus(event, todayKey),
    }));

  return sortTournamentEvents([...eligible, ...upcomingExposureEvents]);
}

function isExposureEvent(event: TournamentEvent): boolean {
  if (event.externalProvider === "exposure_events") return true;
  return Boolean(
    event.sourceUrl?.includes("basketball.exposureevents.com") ||
    event.officialUrl.includes("basketball.exposureevents.com"),
  );
}

function prismaEventToCore(
  event: {
    id: string;
    exposureEventId: number;
    externalProvider: string;
    externalId: string;
    sourceUrl: string | null;
    name: string;
    organizer: string;
    sport: string;
    sanctioningTags: string[];
    gender: string | null;
    ageOrGradeDivisions: string[];
    venueName: string | null;
    city: string | null;
    state: string | null;
    region: string | null;
    startDate: Date;
    endDate: Date;
    location: string;
    officialUrl: string;
    registeredTeamCount: number;
    hasPublicTeamList: boolean;
    lastCheckedAt: Date | null;
    lastSyncedAt: Date | null;
    lastTeamChangeAt: Date | null;
    status: string;
  },
  source?: TournamentSource | null,
  teamCount: number | null = null,
  latestSuccessfulSyncAt: string | null = event.lastSyncedAt?.toISOString() ??
    null,
): TournamentEvent {
  const startDate = event.startDate.toISOString().slice(0, 10);
  const endDate = event.endDate.toISOString().slice(0, 10);
  const status = deriveTournamentStatus({
    startDate,
    endDate,
    status: event.status as TournamentEvent["status"],
  });
  return {
    id: event.id,
    exposureEventId: event.exposureEventId,
    externalProvider: event.externalProvider,
    externalId: event.externalId,
    slug:
      source?.slug ??
      slugFromOfficialUrl(event.officialUrl) ??
      String(event.exposureEventId),
    sourceUrl: event.sourceUrl ?? event.officialUrl,
    name: event.name,
    organizer: event.organizer,
    sport: event.sport,
    sanctioningTags: event.sanctioningTags,
    gender: event.gender,
    ageOrGradeDivisions: event.ageOrGradeDivisions,
    venueName: event.venueName,
    city: event.city,
    state: event.state,
    region: event.region,
    startDate,
    endDate,
    location: event.location,
    officialUrl: event.officialUrl,
    timezone: source?.timezone ?? RENO_TIMEZONE,
    registeredTeamCount: teamCount ?? event.registeredTeamCount,
    hasPublicTeamList: event.hasPublicTeamList,
    lastCheckedAt: event.lastCheckedAt?.toISOString() ?? null,
    lastSyncedAt:
      latestSuccessfulSyncAt ?? event.lastSyncedAt?.toISOString() ?? null,
    lastTeamChangeAt: event.lastTeamChangeAt?.toISOString() ?? null,
    status,
    dropdownGroup: source ? "tracked" : "upcoming",
  };
}

function shouldRecheckPublicTeamList(
  event: {
    externalProvider: string;
    sourceUrl: string | null;
    officialUrl: string;
    startDate: Date;
    endDate: Date;
    lastCheckedAt: Date | null;
    status: string;
  },
  storedTeams: number,
) {
  if (storedTeams > 0) return false;
  const exposureUrl =
    event.sourceUrl?.includes("basketball.exposureevents.com") ||
    event.officialUrl.includes("basketball.exposureevents.com");
  if (event.externalProvider !== "exposure_events" && !exposureUrl)
    return false;
  const status = deriveTournamentStatus({
    startDate: event.startDate.toISOString().slice(0, 10),
    endDate: event.endDate.toISOString().slice(0, 10),
    status: event.status as TournamentEvent["status"],
  });
  if (status === "cancelled" || status === "unavailable") return false;

  const todayKey = tournamentTodayKey();
  const startKey = event.startDate.toISOString().slice(0, 10);
  const endKey = event.endDate.toISOString().slice(0, 10);
  if (startKey > addDaysKey(todayKey, TEAM_LIST_HYDRATION_WINDOW_DAYS))
    return false;
  if (endKey < addDaysKey(todayKey, -1)) return false;

  return (
    !event.lastCheckedAt ||
    Date.now() - event.lastCheckedAt.getTime() >= TEAM_LIST_HYDRATION_STALE_MS
  );
}

function aggregateSyncResults(
  results: Array<{
    status: string;
    source: string;
    teamsCount: number;
    gamesCount: number;
    changesDetected: number;
  }>,
) {
  return {
    status: results.every((result) => result.status === "success")
      ? "success"
      : "failed",
    source:
      Array.from(new Set(results.map((result) => result.source))).join("+") ||
      "mock",
    teamsCount: results.reduce((count, result) => count + result.teamsCount, 0),
    gamesCount: results.reduce((count, result) => count + result.gamesCount, 0),
    changesDetected: results.reduce(
      (count, result) => count + result.changesDetected,
      0,
    ),
  };
}

function syncSourceForTournament(tournament: TournamentSource): string {
  return tournament.externalProvider === "exposure_events" &&
    isExposureConfigured()
    ? "exposure_api"
    : "public_page";
}

function syncFailureStatus(
  tournament: TournamentSource,
  errorMessage: string,
): TournamentEvent["status"] {
  if (
    errorMessage.includes("Public page request failed with 410") ||
    errorMessage.includes("request failed with 410")
  )
    return "unavailable";
  return deriveTournamentStatus({
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    status: tournament.status,
  });
}

function slugFromOfficialUrl(officialUrl: string): string | null {
  try {
    const parts = new URL(officialUrl).pathname.split("/").filter(Boolean);
    return parts[1] ?? null;
  } catch {
    return null;
  }
}

function scopeSnapshot(
  snapshot: CourtWatchSnapshot,
  programId: string,
): CourtWatchSnapshot {
  const followerCounts = teamFollowerCounts(
    snapshot.programs,
    snapshot.matches,
  );
  const selectedProgram =
    snapshot.programs.find((program) => program.id === programId) ??
    ({
      id: programId,
      userId:
        programId === SELECTED_TEAMS_PROGRAM_ID
          ? null
          : programId.replace(/^program-selected-/, "user-device-"),
      programName: SELECTED_TEAMS_PROGRAM_NAME,
      normalizedProgramName: normalizeProgramName(SELECTED_TEAMS_PROGRAM_NAME),
      active: true,
      createdAt: new Date().toISOString(),
    } satisfies ProgramWatchlist);
  const activeProgram = { ...selectedProgram, active: true };
  const matches = snapshot.matches.filter(
    (match) => match.programWatchlistId === programId && match.active,
  );
  const followedTeamIds = new Set(matches.map((match) => match.teamId));

  return {
    ...snapshot,
    programs: [activeProgram],
    aliases: snapshot.aliases.filter(
      (alias) => alias.programWatchlistId === programId,
    ),
    matches,
    teams: snapshot.teams.map((team) => ({
      ...team,
      isFollowed: followedTeamIds.has(team.id),
      followerCount: followerCounts.get(team.id) ?? 0,
    })),
  };
}

function selectedProgramIdForClient(clientId?: string | null): string {
  return clientId
    ? `program-selected-${clientHash(clientId)}`
    : SELECTED_TEAMS_PROGRAM_ID;
}

function selectedUserIdForClient(clientId: string): string {
  return `user-device-${clientHash(clientId)}`;
}

function favoriteWatchOwnerHash(clientId?: string | null): string {
  return clientId ? clientHash(clientId) : "anonymous";
}

async function ensureUserForClient(prisma: PrismaClient, clientId: string) {
  try {
    return await prisma.user.upsert({
      where: { clientId },
      update: {},
      create: {
        clientId,
        displayName: "Court Watch Device",
        timezone: RENO_TIMEZONE,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await prisma.user.findUnique({ where: { clientId } });
    if (existing) return existing;
    throw error;
  }
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function clientHash(clientId: string): string {
  return createHash("sha256")
    .update(clientId.trim())
    .digest("hex")
    .slice(0, 32);
}

async function fetchSourceTeams(
  tournament: TournamentSource,
): Promise<{ divisions: Division[]; teams: Team[] }> {
  if (tournament.externalProvider !== "exposure_events")
    return { divisions: [], teams: [] };
  if (isExposureConfigured()) {
    try {
      const teams = await new ExposureClient().fetchTeams(
        tournament.exposureEventId,
      );
      const divisions = new Map<string, Division>();
      const mappedTeams = teams.map((team) => {
        const divisionName = String(team.Division?.Name ?? "Unknown Division");
        const divisionExposureId = String(
          team.Division?.Id ?? normalizeName(divisionName),
        );
        const divisionId = `division-${tournament.exposureEventId}-${divisionExposureId}`;
        const meta = extractDivisionMeta(divisionName);
        divisions.set(divisionId, {
          id: divisionId,
          eventId: tournament.id,
          exposureDivisionId: divisionExposureId,
          name: divisionName,
          ...meta,
          rawJson: team.Division ?? {},
        });
        return {
          id: `team-${tournament.exposureEventId}-${team.Id}`,
          eventId: tournament.id,
          divisionId,
          exposureTeamId: String(team.Id),
          name: team.Name,
          normalizedName: normalizeName(team.Name),
          clubName: null,
          normalizedClubName: null,
          coachName: null,
          sourceUrl: `${tournament.officialUrl}/teams`,
          divisionName,
          ...meta,
          rawJson: team,
          lastSeenAt: new Date().toISOString(),
        };
      });
      return { divisions: Array.from(divisions.values()), teams: mappedTeams };
    } catch {
      return new PublicExposurePageClient().fetchTeams(
        tournament.exposureEventId,
        tournament.slug,
        tournament.timezone,
      );
    }
  }

  return new PublicExposurePageClient().fetchTeams(
    tournament.exposureEventId,
    tournament.slug,
    tournament.timezone,
  );
}

async function fetchSourceGames(
  selectedDivisionIds: string[],
  tournament: TournamentSource,
): Promise<Array<Record<string, unknown> | Game>> {
  if (tournament.externalProvider !== "exposure_events") return [];
  try {
    if (isExposureConfigured()) {
      const exposureGames = await new ExposureClient().fetchGames(
        tournament.exposureEventId,
      );
      if (exposureGames.length > 0) return exposureGames;
    }
  } catch {
    // Fall through to the public schedule endpoint; old data stays visible if that fails.
  }

  const publicClient = new PublicExposurePageClient();
  const fetchAllPublicGames = shouldFetchAllPublicGames(tournament);
  if (!fetchAllPublicGames && selectedDivisionIds.length === 0) return [];
  return publicClient.fetchGames(tournament.exposureEventId, {
    divisionIds: fetchAllPublicGames ? [] : selectedDivisionIds,
    eventSlug: tournament.slug,
    timezone: tournament.timezone,
  });
}

async function fetchSourceDivisionResults(
  prisma: PrismaClient,
  tournament: TournamentSource,
  eventId: string,
  teamMap: Map<string, Team>,
  divisionIdMap: Map<string, string>,
): Promise<{ fetched: boolean; results: DivisionResult[] }> {
  if (
    tournament.externalProvider !== "exposure_events" ||
    !shouldFetchPublicDivisionResults(tournament)
  )
    return { fetched: false, results: [] };

  try {
    const results = await new PublicExposurePageClient().fetchDivisionResults(
      tournament.exposureEventId,
      { eventSlug: tournament.slug },
    );
    const mappedResults: DivisionResult[] = [];
    for (const result of results) {
      mappedResults.push(
        await mapPublicDivisionResult(
          prisma,
          result,
          eventId,
          teamMap,
          divisionIdMap,
        ),
      );
    }
    return { fetched: true, results: mappedResults };
  } catch (error) {
    console.warn("Public bracket result fetch skipped", {
      eventId: tournament.exposureEventId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return { fetched: false, results: [] };
  }
}

function shouldFetchAllPublicGames(tournament: TournamentSource): boolean {
  if (process.env.EXPOSURE_PUBLIC_FETCH_ALL_GAMES === "true") return true;
  return hasTournamentStarted(tournament);
}

function shouldFetchPublicDivisionResults(tournament: TournamentSource) {
  if (process.env.EXPOSURE_PUBLIC_FETCH_RESULTS === "true") return true;
  const todayKey =
    process.env.COURTWATCH_TODAY ??
    dateKeyInTournamentTimeZone(new Date(), tournament.timezone);
  if (tournament.startDate === tournament.endDate) {
    return todayKey >= tournament.startDate;
  }
  return todayKey >= tournament.endDate;
}

function hasTournamentStarted(tournament: TournamentSource): boolean {
  const todayKey =
    process.env.COURTWATCH_TODAY ??
    dateKeyInTournamentTimeZone(new Date(), tournament.timezone);
  return todayKey >= tournament.startDate;
}

function isRecentlyCompletedTournament(tournament: TournamentSource): boolean {
  const todayKey =
    process.env.COURTWATCH_TODAY ??
    dateKeyInTournamentTimeZone(new Date(), tournament.timezone);
  const cutoff = addDaysKey(
    tournament.endDate,
    RECENTLY_COMPLETED_HYDRATION_DAYS,
  );
  return todayKey <= cutoff;
}

function dateKeyInTournamentTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function addDaysKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function mapPublicDivisionResult(
  prisma: PrismaClient,
  result: DivisionResult,
  eventId: string,
  teamMap: Map<string, Team>,
  divisionIdMap: Map<string, string>,
): Promise<DivisionResult> {
  const raw = isRecord(result.rawJson) ? result.rawJson : {};
  const divisionExposureId = stringOrNull(raw.DivisionId);
  const divisionTeamId = stringOrNull(raw.DivisionTeamId);
  const team =
    (divisionTeamId ? teamMap.get(divisionTeamId) : null) ??
    (result.teamId ? teamMap.get(result.teamId) : null) ??
    null;
  const syntheticDivision = await ensureSyntheticStandingPoolDivision(
    prisma,
    result,
    eventId,
    divisionExposureId,
    divisionIdMap,
  );
  const divisionId =
    syntheticDivision?.id ??
    (divisionExposureId ? divisionIdMap.get(divisionExposureId) : null) ??
    divisionIdMap.get(result.divisionId) ??
    result.divisionId;

  return {
    ...result,
    eventId,
    divisionId,
    divisionName:
      syntheticDivision?.name ?? team?.divisionName ?? result.divisionName,
    gender: syntheticDivision?.gender ?? team?.gender ?? result.gender,
    gradeLevel:
      syntheticDivision?.gradeLevel ?? team?.gradeLevel ?? result.gradeLevel,
    level: syntheticDivision?.level ?? team?.level ?? result.level,
    teamId: team?.id ?? result.teamId,
    teamNameSnapshot: team?.name ?? result.teamNameSnapshot,
    teamSourceUrl: team?.sourceUrl ?? result.teamSourceUrl,
  };
}

async function ensureSyntheticStandingPoolDivision(
  prisma: PrismaClient,
  result: DivisionResult,
  eventId: string,
  divisionExposureId: string | null,
  divisionIdMap: Map<string, string>,
) {
  const raw = isRecord(result.rawJson) ? result.rawJson : {};
  const poolKey = stringOrNull(raw.PoolKey);
  if (!divisionExposureId || !poolKey) return null;

  const parentDivisionId = divisionIdMap.get(divisionExposureId);
  const parentDivision = parentDivisionId
    ? await prisma.division.findUnique({ where: { id: parentDivisionId } })
    : null;
  const exposureDivisionId = `${divisionExposureId}:pool:${poolKey}`;
  const division: Division = {
    id: `${eventId}-${exposureDivisionId}`,
    eventId,
    exposureDivisionId,
    name: result.divisionName,
    gender: parentDivision?.gender ?? result.gender,
    gradeLevel: parentDivision?.gradeLevel ?? result.gradeLevel,
    level: parentDivision?.level ?? result.level,
    rawJson: {
      source: "public_standings_pool",
      parentDivisionId,
      parentExposureDivisionId: divisionExposureId,
      poolName: stringOrNull(raw.PoolName),
    },
  };
  return upsertDivision(prisma, eventId, division);
}

function dedupeSourceTeams(source: { divisions: Division[]; teams: Team[] }): {
  divisions: Division[];
  teams: Team[];
} {
  const divisions = new Map<string, Division>();
  for (const division of source.divisions) {
    divisions.set(division.exposureDivisionId ?? division.id, division);
  }

  const teams = new Map<string, Team>();
  for (const team of source.teams) {
    const key = sourceTeamDedupeKey(team);
    if (!teams.has(key)) teams.set(key, team);
  }

  return {
    divisions: Array.from(divisions.values()),
    teams: Array.from(teams.values()),
  };
}

function sourceTeamDedupeKey(team: Team): string {
  if (team.exposureTeamId) return `external:${team.exposureTeamId}`;
  return [
    "fallback",
    team.divisionId ?? team.divisionName ?? "",
    normalizeName(team.name),
  ].join(":");
}

function isMetadataOnlyTournamentCandidate(
  candidate: PublicTournamentCandidate,
): boolean {
  return (
    !candidate.event.hasPublicTeamList &&
    candidate.teams.divisions.length === 0 &&
    candidate.teams.teams.length === 0
  );
}

async function fetchSourcePlayers(
  eventId: string,
  teamMap: Map<string, Team>,
  tournament: TournamentSource,
): Promise<Player[]> {
  if (tournament.externalProvider !== "exposure_events") return [];
  if (!isExposureConfigured()) return [];
  try {
    const players = await new ExposureClient().fetchPlayers(
      tournament.exposureEventId,
    );
    return players
      .map((player) => mapExposurePlayer(player, eventId, teamMap, tournament))
      .filter((player): player is Player => Boolean(player));
  } catch {
    return [];
  }
}

async function upsertEvent(prisma: PrismaClient, tournament: TournamentSource) {
  return prisma.event.upsert({
    where: { exposureEventId: tournament.exposureEventId },
    update: {
      externalProvider: tournament.externalProvider,
      externalId: tournament.externalId,
      sourceUrl: tournament.sourceUrl,
      name: tournament.name,
      organizer: tournament.organizer,
      sport: tournament.sport,
      sanctioningTags: tournament.sanctioningTags,
      gender: tournament.gender,
      ageOrGradeDivisions: tournament.ageOrGradeDivisions,
      venueName: tournament.venueName,
      city: tournament.city,
      state: tournament.state,
      region: tournament.region,
      startDate: new Date(`${tournament.startDate}T00:00:00.000Z`),
      endDate: new Date(`${tournament.endDate}T00:00:00.000Z`),
      location: tournament.location,
      officialUrl: tournament.officialUrl,
      registeredTeamCount:
        tournament.registeredTeamCount > 0
          ? tournament.registeredTeamCount
          : undefined,
      hasPublicTeamList: tournament.hasPublicTeamList || undefined,
      lastCheckedAt: tournament.lastCheckedAt
        ? new Date(tournament.lastCheckedAt)
        : undefined,
      lastTeamChangeAt: tournament.lastTeamChangeAt
        ? new Date(tournament.lastTeamChangeAt)
        : undefined,
      status: tournament.status,
    },
    create: {
      id: tournament.id,
      exposureEventId: tournament.exposureEventId,
      externalProvider: tournament.externalProvider,
      externalId: tournament.externalId,
      sourceUrl: tournament.sourceUrl,
      name: tournament.name,
      organizer: tournament.organizer,
      sport: tournament.sport,
      sanctioningTags: tournament.sanctioningTags,
      gender: tournament.gender,
      ageOrGradeDivisions: tournament.ageOrGradeDivisions,
      venueName: tournament.venueName,
      city: tournament.city,
      state: tournament.state,
      region: tournament.region,
      startDate: new Date(`${tournament.startDate}T00:00:00.000Z`),
      endDate: new Date(`${tournament.endDate}T00:00:00.000Z`),
      location: tournament.location,
      officialUrl: tournament.officialUrl,
      registeredTeamCount: tournament.registeredTeamCount,
      hasPublicTeamList: tournament.hasPublicTeamList,
      lastCheckedAt: tournament.lastCheckedAt
        ? new Date(tournament.lastCheckedAt)
        : null,
      lastSyncedAt: tournament.lastSyncedAt
        ? new Date(tournament.lastSyncedAt)
        : null,
      lastTeamChangeAt: tournament.lastTeamChangeAt
        ? new Date(tournament.lastTeamChangeAt)
        : null,
      status: tournament.status,
    },
  });
}

async function ensurePrograms(prisma: PrismaClient) {
  await prisma.programWatchlist.updateMany({
    where: { id: { in: LEGACY_AUTO_PROGRAM_IDS } },
    data: { active: false },
  });
  for (const program of seedPrograms) {
    await prisma.programWatchlist.upsert({
      where: { id: program.id },
      update: {
        programName: SELECTED_TEAMS_PROGRAM_NAME,
        normalizedProgramName: normalizeProgramName(
          SELECTED_TEAMS_PROGRAM_NAME,
        ),
        active: true,
      },
      create: {
        id: program.id,
        userId: null,
        programName: SELECTED_TEAMS_PROGRAM_NAME,
        normalizedProgramName: normalizeProgramName(
          SELECTED_TEAMS_PROGRAM_NAME,
        ),
        active: true,
        createdAt: new Date(program.createdAt),
      },
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
          normalizedAlias: alias.normalizedAlias,
        },
      },
      update: {
        alias: alias.alias,
      },
      create: {
        id: alias.id,
        programWatchlistId: alias.programWatchlistId,
        alias: alias.alias,
        normalizedAlias: alias.normalizedAlias,
        createdAt: new Date(alias.createdAt),
      },
    });
  }
}

async function upsertSeedDivisionsTeamsAndGames(
  prisma: PrismaClient,
  eventId: string,
  includeMockArsenal = true,
) {
  const allowedDivisions = seedDivisions.filter(
    (division) =>
      division.eventId === eventId &&
      (includeMockArsenal || !division.id.includes("arsenal")),
  );
  const allowedDivisionIds = new Set(
    allowedDivisions.map((division) => division.id),
  );
  const allowedTeams = seedTeams.filter(
    (team) =>
      allowedDivisionIds.has(team.divisionId ?? "") &&
      (includeMockArsenal || !team.id.includes("arsenal")),
  );
  const allowedTeamIds = new Set(allowedTeams.map((team) => team.id));
  const allowedGames = seedGames.filter(
    (game) =>
      game.eventId === eventId &&
      (game.homeTeamId ? allowedTeamIds.has(game.homeTeamId) : true) &&
      (game.awayTeamId ? allowedTeamIds.has(game.awayTeamId) : true),
  );
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
  for (const change of seedChangeEvents.filter(
    (event) => !event.gameId || allowedGameIds.has(event.gameId),
  )) {
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
        dedupeKey: change.dedupeKey,
      },
    });
  }
}

async function removeMockArsenalSeedData(prisma: PrismaClient) {
  const mockTeamIds = seedTeams
    .filter((team) => team.id.includes("arsenal"))
    .map((team) => team.id);
  const mockDivisionIds = seedDivisions
    .filter((division) => division.id.includes("arsenal"))
    .map((division) => division.id);
  const mockTeamIdSet = new Set(mockTeamIds);
  const mockGameIds = seedGames
    .filter(
      (game) =>
        (game.homeTeamId ? mockTeamIdSet.has(game.homeTeamId) : false) ||
        (game.awayTeamId ? mockTeamIdSet.has(game.awayTeamId) : false),
    )
    .map((game) => game.id);

  await prisma.programTeamMatch.deleteMany({
    where: { teamId: { in: mockTeamIds } },
  });
  await prisma.gameChangeEvent.deleteMany({
    where: {
      OR: [
        { affectedTeamId: { in: mockTeamIds } },
        { gameId: { in: mockGameIds } },
      ],
    },
  });
  await prisma.game.deleteMany({ where: { id: { in: mockGameIds } } });
  await prisma.team.deleteMany({ where: { id: { in: mockTeamIds } } });
  await prisma.division.deleteMany({ where: { id: { in: mockDivisionIds } } });
}

async function removeSeedGameAndChangeData(prisma: PrismaClient) {
  const seedGameIds = seedGames.map((game) => game.id);
  const seedExposureGameIds = seedGames.map(
    (game) => game.exposureGameId ?? game.id,
  );
  const seedChangeIds = [
    ...seedChangeEvents.map((event) => event.id),
    "change-splash-3-final",
  ];
  const seedChangeDedupeKeys = seedChangeEvents.map((event) => event.dedupeKey);

  await prisma.gameChangeEvent.deleteMany({
    where: {
      OR: [
        { affectedProgramWatchlistId: { in: LEGACY_AUTO_PROGRAM_IDS } },
        { id: { in: seedChangeIds } },
        { dedupeKey: { in: seedChangeDedupeKeys } },
        { gameId: { in: seedGameIds } },
      ],
    },
  });
  await prisma.game.deleteMany({
    where: {
      OR: [
        { id: { in: seedGameIds } },
        { exposureGameId: { in: seedExposureGameIds } },
      ],
    },
  });
}

async function upsertDivision(
  prisma: PrismaClient,
  eventId: string,
  division: Division,
) {
  const exposureDivisionId = division.exposureDivisionId ?? division.id;
  return prisma.division.upsert({
    where: { eventId_exposureDivisionId: { eventId, exposureDivisionId } },
    update: {
      name: division.name,
      gender: division.gender,
      gradeLevel: division.gradeLevel,
      level: division.level,
      rawJson: (division.rawJson ?? {}) as object,
    },
    create: {
      id: division.id,
      eventId,
      exposureDivisionId,
      name: division.name,
      gender: division.gender,
      gradeLevel: division.gradeLevel,
      level: division.level,
      rawJson: (division.rawJson ?? {}) as object,
    },
  });
}

async function upsertSourceDivisionsAndTeams(
  prisma: PrismaClient,
  eventId: string,
  sourceTeams: { divisions: Division[]; teams: Team[] },
): Promise<Map<string, string>> {
  const divisionIdMap = new Map<string, string>();
  for (const division of sourceTeams.divisions) {
    const savedDivision = await upsertDivision(prisma, eventId, division);
    divisionIdMap.set(division.id, savedDivision.id);
    if (division.exposureDivisionId) {
      divisionIdMap.set(division.exposureDivisionId, savedDivision.id);
    }
  }
  for (const [key, value] of await loadDivisionIdMap(prisma, eventId)) {
    if (!divisionIdMap.has(key)) divisionIdMap.set(key, value);
  }
  for (const team of sourceTeams.teams) {
    await upsertTeam(prisma, eventId, {
      ...team,
      divisionId: team.divisionId
        ? (divisionIdMap.get(team.divisionId) ?? team.divisionId)
        : null,
    });
  }
  return divisionIdMap;
}

async function upsertTeam(prisma: PrismaClient, eventId: string, team: Team) {
  return prisma.team.upsert({
    where: {
      eventId_exposureTeamId: {
        eventId,
        exposureTeamId: team.exposureTeamId ?? team.id,
      },
    },
    update: {
      divisionId: team.divisionId,
      name: team.name,
      normalizedName: normalizeName(team.name),
      clubName: team.clubName,
      normalizedClubName: team.clubName ? normalizeName(team.clubName) : null,
      coachName: team.coachName,
      city: team.city ?? null,
      state: team.state ?? null,
      sourceUrl: team.sourceUrl,
      rawJson: (team.rawJson ?? {}) as object,
      lastSeenAt: new Date(),
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
      city: team.city ?? null,
      state: team.state ?? null,
      sourceUrl: team.sourceUrl,
      rawJson: (team.rawJson ?? {}) as object,
      lastSeenAt: new Date(team.lastSeenAt),
    },
  });
}

async function loadEventTeamExternalIds(
  prisma: PrismaClient,
  eventId: string,
): Promise<Set<string>> {
  const teams = await prisma.team.findMany({
    where: { eventId },
    select: { id: true, exposureTeamId: true },
  });
  return new Set(teams.map((team) => team.exposureTeamId ?? team.id));
}

function haveTeamExternalIdsChanged(
  previousTeamIds: Set<string>,
  teams: Team[],
): boolean {
  const nextTeamIds = new Set(
    teams.map((team) => team.exposureTeamId ?? team.id),
  );
  if (previousTeamIds.size !== nextTeamIds.size) return true;
  for (const teamId of nextTeamIds) {
    if (!previousTeamIds.has(teamId)) return true;
  }
  return false;
}

async function removeTeamsMissingFromPublicList(
  prisma: PrismaClient,
  eventId: string,
  teams: Team[],
) {
  const externalIds = teams
    .map((team) => team.exposureTeamId ?? team.id)
    .filter(Boolean);
  await prisma.team.deleteMany({
    where: {
      eventId,
      exposureTeamId:
        externalIds.length > 0 ? { notIn: externalIds } : { not: null },
    },
  });
}

async function upsertPlayer(
  prisma: PrismaClient,
  eventId: string,
  player: Player,
) {
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
      lastSeenAt: new Date(),
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
      lastSeenAt: new Date(player.lastSeenAt),
    },
  });
}

async function upsertGame(prisma: PrismaClient, game: Game) {
  return prisma.game.upsert({
    where: {
      eventId_exposureGameId: {
        eventId: game.eventId,
        exposureGameId: game.exposureGameId ?? game.id,
      },
    },
    update: gameWrite(game),
    create: {
      id: game.id,
      eventId: game.eventId,
      exposureGameId: game.exposureGameId ?? game.id,
      ...gameWrite(game),
    },
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
    homeScore: sanitizeBasketballScore(game.homeScore),
    awayScore: sanitizeBasketballScore(game.awayScore),
    status: game.status,
    officialUrl: game.officialUrl,
    streamingUrl: game.streamingUrl,
    sourceHash: game.sourceHash,
    rawJson: (game.rawJson ?? {}) as object,
  };
}

async function upsertDivisionResult(
  prisma: PrismaClient,
  result: DivisionResult,
) {
  const existingPlacement = await prisma.divisionResult.findUnique({
    where: {
      eventId_divisionId_placement: {
        eventId: result.eventId,
        divisionId: result.divisionId,
        placement: result.placement,
      },
    },
    select: {
      teamId: true,
      teamNameSnapshot: true,
      medalLabel: true,
      bracketLabel: true,
      sourceUrl: true,
      isOfficial: true,
    },
  });
  const existingById = await prisma.divisionResult.findUnique({
    where: { id: result.id },
    select: { id: true, eventId: true, divisionId: true, placement: true },
  });
  const write = {
    eventId: result.eventId,
    divisionId: result.divisionId,
    teamId: result.teamId,
    placement: result.placement,
    teamNameSnapshot: result.teamNameSnapshot,
    medalLabel: result.medalLabel,
    bracketLabel: result.bracketLabel,
    source: result.source,
    sourceUrl: result.sourceUrl,
    isOfficial: result.isOfficial,
    sourceHash: result.sourceHash,
    rawJson: (result.rawJson ?? {}) as object,
    lastSeenAt: new Date(result.lastSeenAt),
  };

  if (
    existingById &&
    (existingById.eventId !== result.eventId ||
      existingById.divisionId !== result.divisionId ||
      existingById.placement !== result.placement)
  ) {
    try {
      const saved = await prisma.divisionResult.update({
        where: { id: result.id },
        data: write,
      });
      await recordFinalPlacementChangeEvent(prisma, result, existingPlacement);
      return saved;
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;
      await prisma.divisionResult.delete({ where: { id: result.id } });
    }
  }

  try {
    const saved = await prisma.divisionResult.upsert({
      where: {
        eventId_divisionId_placement: {
          eventId: result.eventId,
          divisionId: result.divisionId,
          placement: result.placement,
        },
      },
      update: {
        teamId: result.teamId,
        teamNameSnapshot: result.teamNameSnapshot,
        medalLabel: result.medalLabel,
        bracketLabel: result.bracketLabel,
        source: result.source,
        sourceUrl: result.sourceUrl,
        isOfficial: result.isOfficial,
        sourceHash: result.sourceHash,
        rawJson: (result.rawJson ?? {}) as object,
        lastSeenAt: new Date(result.lastSeenAt),
      },
      create: {
        id: result.id,
        ...write,
      },
    });
    await recordFinalPlacementChangeEvent(prisma, result, existingPlacement);
    return saved;
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) throw error;
    const saved = await prisma.divisionResult.update({
      where: { id: result.id },
      data: write,
    });
    await recordFinalPlacementChangeEvent(prisma, result, existingPlacement);
    return saved;
  }
}

async function recordFinalPlacementChangeEvent(
  prisma: PrismaClient,
  result: DivisionResult,
  previous: {
    teamId: string | null;
    teamNameSnapshot: string;
    medalLabel: string;
    bracketLabel: string | null;
    sourceUrl: string | null;
    isOfficial: boolean;
  } | null,
) {
  if (!shouldRecordFinalPlacementChange(previous, result)) return;

  const dedupeKey = finalPlacementChangeDedupeKey(result);
  await prisma.gameChangeEvent.upsert({
    where: { dedupeKey },
    update: {},
    create: {
      gameId: null,
      affectedTeamId: result.teamId,
      affectedProgramWatchlistId: null,
      eventType: "final_placement",
      previousValue: previous
        ? finalPlacementPreviousPayload(previous)
        : Prisma.JsonNull,
      newValue: finalPlacementChangePayload(result),
      dedupeKey,
    },
  });
}

function shouldRecordFinalPlacementChange(
  previous: {
    teamId: string | null;
    teamNameSnapshot: string;
    medalLabel: string;
    bracketLabel: string | null;
    sourceUrl: string | null;
    isOfficial: boolean;
  } | null,
  result: DivisionResult,
): boolean {
  if (!result.teamNameSnapshot.trim()) return false;
  if (!previous) return true;
  return (
    previous.teamId !== result.teamId ||
    previous.teamNameSnapshot !== result.teamNameSnapshot ||
    previous.medalLabel !== result.medalLabel ||
    previous.bracketLabel !== result.bracketLabel ||
    previous.sourceUrl !== result.sourceUrl ||
    previous.isOfficial !== result.isOfficial
  );
}

function finalPlacementChangeDedupeKey(result: DivisionResult): string {
  return [
    "final-placement",
    result.eventId,
    result.divisionId,
    String(result.placement),
    result.teamId ?? normalizeName(result.teamNameSnapshot),
  ].join(":");
}

function finalPlacementChangePayload(result: DivisionResult) {
  return {
    teamName: result.teamNameSnapshot,
    divisionName: result.divisionName,
    placement: result.placement,
    medalLabel: result.medalLabel,
    placementLabel: finalPlacementLabel(result.placement),
    bracketLabel: result.bracketLabel,
    sourceUrl: result.sourceUrl,
    isOfficial: result.isOfficial,
  };
}

function finalPlacementPreviousPayload(previous: {
  teamId: string | null;
  teamNameSnapshot: string;
  medalLabel: string;
  bracketLabel: string | null;
  sourceUrl: string | null;
  isOfficial: boolean;
}) {
  return {
    teamId: previous.teamId,
    teamName: previous.teamNameSnapshot,
    medalLabel: previous.medalLabel,
    bracketLabel: previous.bracketLabel,
    sourceUrl: previous.sourceUrl,
    isOfficial: previous.isOfficial,
  };
}

function finalPlacementLabel(placement: ResultPlacement): string {
  if (placement === 1) return "Champion / 1st / Gold";
  if (placement === 2) return "2nd / Silver";
  return "3rd / Bronze";
}

async function replaceDivisionResultsForEvent(
  prisma: PrismaClient,
  eventId: string,
  results: DivisionResult[],
) {
  for (const result of results) {
    await upsertDivisionResult(prisma, result);
  }

  const keepConditions = Array.from(
    new Map(
      results.map((result) => [
        `${result.divisionId}:${result.placement}`,
        { divisionId: result.divisionId, placement: result.placement },
      ]),
    ).values(),
  );

  await prisma.divisionResult.deleteMany({
    where: {
      eventId,
      ...(keepConditions.length > 0 ? { NOT: keepConditions } : {}),
    },
  });
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function loadTeamMap(
  prisma: PrismaClient,
  eventId: string,
): Promise<Map<string, Team>> {
  const teams = await prisma.team.findMany({
    where: { eventId },
    include: { division: true },
  });
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
        city: team.city,
        state: team.state,
        sourceUrl: team.sourceUrl,
        divisionName: team.division?.name ?? null,
        gender: team.division?.gender ?? null,
        gradeLevel: team.division?.gradeLevel ?? null,
        level: team.division?.level ?? null,
        rawJson: team.rawJson,
        lastSeenAt: team.lastSeenAt.toISOString(),
        createdAt: team.createdAt.toISOString(),
        updatedAt: team.updatedAt.toISOString(),
      };
      return [
        [team.id, coreTeam],
        ...(team.exposureTeamId
          ? ([[team.exposureTeamId, coreTeam]] as Array<[string, Team]>)
          : []),
      ] as Array<[string, Team]>;
    }),
  );
}

async function loadDivisionIdMap(
  prisma: PrismaClient,
  eventId: string,
): Promise<Map<string, string>> {
  const divisions = await prisma.division.findMany({
    where: { eventId },
    select: { id: true, exposureDivisionId: true },
  });
  return new Map(
    divisions.flatMap((division) => [
      [division.id, division.id],
      ...(division.exposureDivisionId
        ? ([[division.exposureDivisionId, division.id]] as Array<
            [string, string]
          >)
        : []),
    ]),
  );
}

async function loadSelectedDivisionExposureIds(
  prisma: PrismaClient,
  eventId: string,
): Promise<string[]> {
  const followedTeams = await prisma.team.findMany({
    where: {
      eventId,
      matches: {
        some: {
          active: true,
          programWatchlist: {
            active: true,
            normalizedProgramName: normalizeProgramName(
              SELECTED_TEAMS_PROGRAM_NAME,
            ),
          },
        },
      },
    },
    include: { division: true },
  });
  return Array.from(
    new Set(
      followedTeams
        .map((team) => team.division?.exposureDivisionId)
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function isCoreGame(value: unknown): value is Game {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.startsAt === "string" &&
    typeof value.scheduledDate === "string"
  );
}

function mapStoredSourceGame(
  game: Game,
  eventId: string,
  teamMap: Map<string, Team>,
  divisionIdMap: Map<string, string>,
): Game {
  const raw = isRecord(game.rawJson) ? game.rawJson : {};
  const homeDivisionTeamId = stringOrNull(raw.HomeDivisionTeamId);
  const awayDivisionTeamId = stringOrNull(raw.AwayDivisionTeamId);
  const divisionExposureId = stringOrNull(raw.DivisionId);
  return {
    ...game,
    eventId,
    divisionId:
      (divisionExposureId ? divisionIdMap.get(divisionExposureId) : null) ??
      (game.divisionId
        ? (divisionIdMap.get(game.divisionId) ?? game.divisionId)
        : null),
    homeTeamId:
      (homeDivisionTeamId ? teamMap.get(homeDivisionTeamId)?.id : null) ??
      game.homeTeamId,
    awayTeamId:
      (awayDivisionTeamId ? teamMap.get(awayDivisionTeamId)?.id : null) ??
      game.awayTeamId,
  };
}

function mapExposureGame(
  raw: Record<string, unknown>,
  eventId: string,
  teamMap: Map<string, Team>,
  tournament: TournamentSource,
  divisionIdMap: Map<string, string>,
): Game | null {
  const id = String(raw.Id ?? "");
  if (!id) return null;
  const division = raw.Division as
    | { Id?: number | string; Name?: string }
    | undefined;
  const venueCourt = raw.VenueCourt as
    | { Court?: { Name?: string }; Venue?: { Name?: string } }
    | undefined;
  const home = raw.HomeTeam as
    | { TeamId?: number | string; Name?: string; Score?: number }
    | undefined;
  const away = raw.AwayTeam as
    | { TeamId?: number | string; Name?: string; Score?: number }
    | undefined;
  const homeTeam = home?.TeamId ? teamMap.get(String(home.TeamId)) : null;
  const awayTeam = away?.TeamId ? teamMap.get(String(away.TeamId)) : null;
  const date = String(raw.Date ?? tournament.startDate);
  const time = String(raw.Time ?? "12:00 PM");
  const startsAt = parseTournamentDateTime(date, time, tournament.timezone);
  const rawHash = hashSource(raw);

  return {
    id: `game-${tournament.exposureEventId}-${id}`,
    eventId,
    divisionId: division?.Id
      ? (divisionIdMap.get(String(division.Id)) ??
        `division-${tournament.exposureEventId}-${division.Id}`)
      : null,
    exposureGameId: id,
    gameNumber: raw.Number ? String(raw.Number) : null,
    gameType: raw.BracketName
      ? `Bracket ${String(raw.BracketName)}`
      : raw.Type
        ? String(raw.Type)
        : null,
    scheduledDate: toIsoDate(date),
    scheduledTime: time,
    startsAt: startsAt.toISOString(),
    timezone: tournament.timezone,
    venueName: venueCourt?.Venue?.Name ?? null,
    courtName: venueCourt?.Court?.Name ?? null,
    homeTeamId: homeTeam?.id ?? null,
    awayTeamId: awayTeam?.id ?? null,
    homeTeamNameSnapshot: homeTeam?.name ?? home?.Name ?? null,
    awayTeamNameSnapshot: awayTeam?.name ?? away?.Name ?? null,
    homeScore: typeof home?.Score === "number" ? home.Score : null,
    awayScore: typeof away?.Score === "number" ? away.Score : null,
    status:
      typeof home?.Score === "number" && typeof away?.Score === "number"
        ? "final"
        : "upcoming",
    officialUrl: `${tournament.officialUrl}/schedule`,
    streamingUrl: null,
    updatedAt: new Date().toISOString(),
    sourceHash: rawHash,
    rawJson: raw,
  };
}

function mapExposurePlayer(
  raw: Record<string, unknown>,
  eventId: string,
  teamMap: Map<string, Team>,
  tournament: TournamentSource,
): Player | null {
  const id = stringOrNull(raw.Id);
  if (!id) return null;
  const profile = isRecord(raw.Profile) ? raw.Profile : {};
  const firstName = stringOrNull(raw.FirstName);
  const lastName = stringOrNull(raw.LastName);
  const fullName =
    stringOrNull(raw.Name) ??
    [firstName, lastName].filter(Boolean).join(" ").trim();
  if (!fullName) return null;
  const team = extractExposureTeamIds(raw)
    .map((teamId) => teamMap.get(teamId))
    .find((item): item is Team => Boolean(item));

  return {
    id: `player-${tournament.exposureEventId}-${id}`,
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
    lastSeenAt: new Date().toISOString(),
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

function filterTeamsForSearch(
  snapshot: CourtWatchSnapshot,
  normalizedSearch: string,
): Team[] {
  const records = buildTeamRecordSummaryMap(snapshot.games, snapshot.teams);
  const activeProgramIds = new Set(
    snapshot.programs
      .filter((program) => program.active)
      .map((program) => program.id),
  );
  const followedTeamIds = new Set(
    snapshot.matches
      .filter(
        (match) =>
          match.active && activeProgramIds.has(match.programWatchlistId),
      )
      .map((match) => match.teamId),
  );
  const followerCounts = teamFollowerCounts(
    snapshot.programs,
    snapshot.matches,
  );

  return snapshot.teams
    .map((team) => ({
      ...team,
      isFollowed:
        typeof team.isFollowed === "boolean"
          ? team.isFollowed
          : followedTeamIds.has(team.id),
      followerCount: team.followerCount ?? followerCounts.get(team.id) ?? 0,
      record: records.get(team.id),
    }))
    .filter((team) => {
      if (!normalizedSearch) return true;
      return (
        team.normalizedName.includes(normalizedSearch) ||
        normalizeName(team.clubName).includes(normalizedSearch) ||
        normalizeName(team.divisionName).includes(normalizedSearch)
      );
    })
    .sort(compareRegisteredTeams);
}

function allEventsTeamSearchWhere(search?: string): Prisma.TeamWhereInput {
  const trimmed = search?.trim() ?? "";
  const normalized = normalizeName(trimmed);
  const scopedEvents: Prisma.TeamWhereInput = {
    event: { is: courtWatchEventScopeWhere() },
  };
  if (!normalized) return scopedEvents;
  return {
    AND: [
      scopedEvents,
      {
        OR: [
          { normalizedName: { contains: normalized } },
          { normalizedClubName: { contains: normalized } },
          { name: { contains: trimmed, mode: "insensitive" } },
          { clubName: { contains: trimmed, mode: "insensitive" } },
          {
            division: {
              is: { name: { contains: trimmed, mode: "insensitive" } },
            },
          },
        ],
      },
    ],
  };
}

function buildTeamRecordSummaryMap(
  games: Game[],
  teams: Team[],
): Map<string, TeamRecordSummary> {
  const leaders = buildTeamScoringLeaders(games, teams, {
    includeUnscoredTeams: true,
  });
  const records = new Map<string, TeamRecordSummary>();
  for (const leader of leaders) {
    if (!leader.teamId) continue;
    if (leader.gamesScored <= 0) continue;
    records.set(leader.teamId, {
      wins: leader.wins,
      losses: leader.losses,
      ties: leader.ties,
      gamesScored: leader.gamesScored,
      totalPoints: leader.totalPoints,
      finalGames: 0,
      gamesSeen: 0,
    });
  }

  for (const game of games) {
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      if (!teamId) continue;
      const record = records.get(teamId);
      if (!record) continue;
      record.gamesSeen += 1;
      if (game.status === "final") record.finalGames += 1;
    }
  }

  return records;
}

function teamFollowerCounts(
  programs: Array<
    Pick<ProgramWatchlist, "active" | "id" | "normalizedProgramName" | "userId">
  >,
  matches: Array<
    Pick<ProgramTeamMatch, "active" | "programWatchlistId" | "teamId">
  >,
): Map<string, number> {
  const countableProgramIds = new Set(
    programs
      .filter(
        (program) =>
          program.active &&
          program.userId &&
          program.normalizedProgramName ===
            normalizeProgramName(SELECTED_TEAMS_PROGRAM_NAME),
      )
      .map((program) => program.id),
  );
  const programTeamPairs = new Set<string>();
  for (const match of matches) {
    if (!match.active || !countableProgramIds.has(match.programWatchlistId))
      continue;
    programTeamPairs.add(`${match.programWatchlistId}:${match.teamId}`);
  }

  const counts = new Map<string, number>();
  for (const pair of programTeamPairs) {
    const teamId = pair.split(":").slice(1).join(":");
    counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
  }
  return counts;
}

function compareRegisteredTeams(left: Team, right: Team): number {
  return (
    teamSortCollator.compare(teamAlphaGroup(left), teamAlphaGroup(right)) ||
    teamSortCollator.compare(left.name, right.name) ||
    teamSortCollator.compare(
      left.divisionName ?? "",
      right.divisionName ?? "",
    ) ||
    teamSortCollator.compare(left.id, right.id)
  );
}

function teamAlphaGroup(team: Team): string {
  return team.name.trim();
}

function groupPlayerNamesByTeam(players: Player[]): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const player of players) {
    if (!player.teamId) continue;
    names.set(player.teamId, [
      ...(names.get(player.teamId) ?? []),
      player.fullName,
    ]);
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

function parseTournamentDateTime(
  date: string,
  time: string,
  timezone: string,
): Date {
  const [month = "5", day = "23", year = "2026"] = date.split("/");
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  let hour = Number(match?.[1] ?? 12);
  const minute = Number(match?.[2] ?? 0);
  const meridiem = (match?.[3] ?? "PM").toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  const local = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  return fromZonedTime(local, timezone);
}

function toIsoDate(date: string): string {
  const [month = "5", day = "23", year = "2026"] = date.split("/");
  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function prismaGameToCore(
  game: Awaited<ReturnType<PrismaClient["game"]["findFirst"]>> extends infer T
    ? NonNullable<T>
    : never,
): Game {
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
    homeScore: sanitizeBasketballScore(game.homeScore),
    awayScore: sanitizeBasketballScore(game.awayScore),
    status: game.status as Game["status"],
    officialUrl: game.officialUrl,
    streamingUrl: game.streamingUrl,
    updatedAt: game.updatedAt.toISOString(),
    sourceHash: game.sourceHash,
    rawJson: game.rawJson,
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
    lastSeenAt: player.lastSeenAt.toISOString(),
  };
}

function prismaProgramToCore(program: {
  id: string;
  userId: string | null;
  programName: string;
  normalizedProgramName: string;
  active: boolean;
  createdAt: Date;
}): ProgramWatchlist {
  return {
    id: program.id,
    userId: program.userId,
    programName: program.programName,
    normalizedProgramName: program.normalizedProgramName,
    active: program.active,
    createdAt: program.createdAt.toISOString(),
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
    createdAt: match.createdAt.toISOString(),
  };
}

function prismaFavoriteTeamWatchToCore(watch: {
  id: string;
  displayName: string;
  normalizedName: string;
  source: string;
  sourceTeamId: string | null;
  sourceTeamName: string | null;
  eventName: string | null;
  divisionName: string | null;
  gender: string | null;
  gradeLevel: string | null;
  level: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): FavoriteTeamWatch {
  return {
    id: watch.id,
    displayName: watch.displayName,
    normalizedName: watch.normalizedName,
    source: watch.source === "registered" ? "registered" : "custom",
    sourceTeamId: watch.sourceTeamId,
    sourceTeamName: watch.sourceTeamName,
    eventName: watch.eventName,
    divisionName: watch.divisionName,
    gender: watch.gender,
    gradeLevel: watch.gradeLevel,
    level: watch.level,
    active: watch.active,
    createdAt: watch.createdAt.toISOString(),
    updatedAt: watch.updatedAt.toISOString(),
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
    dedupeKey: change.dedupeKey,
  };
}
