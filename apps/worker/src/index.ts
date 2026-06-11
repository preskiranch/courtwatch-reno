import {
  DEFAULT_MAJOR_TOURNAMENT_SOURCES,
  TournamentDiscoveryService,
  calculatePollDelayMs,
  isAnyActiveTournamentWindow,
  isCourtWatchSupportedTournamentRegion,
} from "@courtwatch/core";
import type { TournamentEvent } from "@courtwatch/core";
import { prisma } from "@courtwatch/db";
import pino from "pino";
import { z } from "zod";

const EnvSchema = z.object({
  API_BASE_URL: z.string().url().default("http://localhost:4000"),
  ADMIN_SECRET: z.string().optional(),
  NODE_ENV: z.string().default("development"),
  TOURNAMENT_DISCOVERY_INTERVAL_HOURS: z.coerce.number().default(6),
  TOURNAMENT_DISCOVERY_WINDOW_DAYS: z.coerce.number().default(183),
  WORKER_SYNC_BATCH_SIZE: z.coerce.number().default(8),
  WORKER_SYNC_CONCURRENCY: z.coerce.number().default(3),
  WORKER_ACTIVE_GAME_STALE_MS: z.coerce.number().default(90_000),
  WORKER_TEAM_LIST_RECHECK_STALE_MS: z.coerce
    .number()
    .default(15 * 60_000),
  WORKER_TEAM_LIST_RECHECK_WINDOW_DAYS: z.coerce.number().default(14),
  WORKER_EVENT_SYNC_TIMEOUT_MS: z.coerce.number().default(90_000),
  WORKER_API_TIMEOUT_MS: z.coerce.number().default(300_000),
});

const env = EnvSchema.parse(process.env);
const logger = pino({ name: "courtwatch-reno-sync-worker" });
let failureCount = 0;
let shuttingDown = false;
let lastDiscoveryAt = 0;

function courtWatchEventScopeWhere() {
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

process.on("SIGTERM", () => {
  shuttingDown = true;
  logger.info("received SIGTERM, stopping after current sync");
});

process.on("SIGINT", () => {
  shuttingDown = true;
  logger.info("received SIGINT, stopping after current sync");
});

async function syncOnce() {
  try {
    await discoverTournamentsIfDue();
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : error },
      "tournament discovery failed; continuing with normal sync",
    );
  }
  const targets = await syncTargets();
  const results = await mapWithConcurrency(
    targets,
    env.WORKER_SYNC_CONCURRENCY,
    async (target) => {
      try {
        return await syncSingleEvent(target);
      } catch (error) {
        logger.warn(
          {
            exposureEventId: target.exposureEventId,
            name: target.name,
            error: error instanceof Error ? error.message : error,
          },
          "event sync skipped",
        );
        return {
          status: "failed",
          teamsCount: 0,
          gamesCount: 0,
          changesDetected: 0,
        };
      }
    },
  );

  return {
    status: results.every((result) => result.status === "success")
      ? "success"
      : "partial",
    targetsCount: targets.length,
    teamsCount: results.reduce((count, result) => count + result.teamsCount, 0),
    gamesCount: results.reduce((count, result) => count + result.gamesCount, 0),
    changesDetected: results.reduce(
      (count, result) => count + result.changesDetected,
      0,
    ),
  };
}

async function syncTargets(): Promise<TournamentEvent[]> {
  const response = await fetchWithTimeout(
    new URL("/api/events", env.API_BASE_URL),
  );
  if (!response.ok) {
    throw new Error(
      `events failed with ${response.status}: ${await response.text()}`,
    );
  }
  const events = (await response.json()) as TournamentEvent[];
  const activeGamePriorityIds = await activeGamePriorityExposureIds();
  const preferredIds = preferredExposureEventIds();
  const today = new Date().toISOString().slice(0, 10);
  return events
    .filter((event) => event.status !== "cancelled")
    .sort((left, right) => {
      const leftNeedsGames = activeGamePriorityIds.has(left.exposureEventId)
        ? 0
        : 1;
      const rightNeedsGames = activeGamePriorityIds.has(right.exposureEventId)
        ? 0
        : 1;
      if (leftNeedsGames !== rightNeedsGames)
        return leftNeedsGames - rightNeedsGames;

      const leftPreferred = preferredIds.has(left.exposureEventId) ? 0 : 1;
      const rightPreferred = preferredIds.has(right.exposureEventId) ? 0 : 1;
      if (leftPreferred !== rightPreferred)
        return leftPreferred - rightPreferred;

      const leftNeedsTeams = needsPublishedTeamHydration(left) ? 0 : 1;
      const rightNeedsTeams = needsPublishedTeamHydration(right) ? 0 : 1;
      if (leftNeedsTeams !== rightNeedsTeams)
        return leftNeedsTeams - rightNeedsTeams;

      const leftNeedsTeamRefresh = needsPublicTeamListRecheck(left) ? 0 : 1;
      const rightNeedsTeamRefresh = needsPublicTeamListRecheck(right) ? 0 : 1;
      if (leftNeedsTeamRefresh !== rightNeedsTeamRefresh)
        return leftNeedsTeamRefresh - rightNeedsTeamRefresh;

      const leftStatus = syncStatusPriority(left.status);
      const rightStatus = syncStatusPriority(right.status);
      if (leftStatus !== rightStatus) return leftStatus - rightStatus;

      const leftFreshness = left.lastSyncedAt ?? left.lastCheckedAt ?? "";
      const rightFreshness = right.lastSyncedAt ?? right.lastCheckedAt ?? "";
      if (leftFreshness !== rightFreshness)
        return leftFreshness.localeCompare(rightFreshness);

      const leftSoon = Math.abs(left.startDate.localeCompare(today));
      const rightSoon = Math.abs(right.startDate.localeCompare(today));
      if (leftSoon !== rightSoon) return leftSoon - rightSoon;

      return left.name.localeCompare(right.name);
    })
    .slice(0, Math.max(1, env.WORKER_SYNC_BATCH_SIZE));
}

async function syncSingleEvent(event: TournamentEvent) {
  const response = await fetchWithTimeout(
    new URL("/api/admin/sync-now", env.API_BASE_URL),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.ADMIN_SECRET ? { "x-admin-secret": env.ADMIN_SECRET } : {}),
      },
      body: JSON.stringify({
        source: "worker",
        exposureEventId: event.exposureEventId,
      }),
    },
    env.WORKER_EVENT_SYNC_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(
      `sync-now failed with ${response.status}: ${await response.text()}`,
    );
  }

  return response.json() as Promise<{
    status: string;
    teamsCount: number;
    gamesCount: number;
    changesDetected: number;
  }>;
}

function syncStatusPriority(status: TournamentEvent["status"]) {
  if (status === "active") return 0;
  if (status === "upcoming") return 1;
  if (status === "completed") return 2;
  return 3;
}

function needsPublishedTeamHydration(event: TournamentEvent) {
  return (
    event.status !== "completed" &&
    event.hasPublicTeamList &&
    event.registeredTeamCount > 0 &&
    !event.lastSyncedAt
  );
}

function needsPublicTeamListRecheck(event: TournamentEvent) {
  if (!isCourtWatchSupportedTournamentRegion(event)) return false;
  if (event.status === "cancelled" || event.status === "unavailable")
    return false;
  if (!isExposureTournament(event)) return false;

  const todayKey = dateKeyInPacific(new Date());
  if (
    event.startDate >
    addDaysKey(todayKey, env.WORKER_TEAM_LIST_RECHECK_WINDOW_DAYS)
  )
    return false;
  if (event.endDate < addDaysKey(todayKey, -1)) return false;

  const lastCheckedAt = event.lastCheckedAt
    ? Date.parse(event.lastCheckedAt)
    : Number.NaN;
  return (
    Number.isNaN(lastCheckedAt) ||
    Date.now() - lastCheckedAt >= env.WORKER_TEAM_LIST_RECHECK_STALE_MS
  );
}

function isExposureTournament(event: TournamentEvent) {
  return (
    event.externalProvider === "exposure_events" ||
    event.sourceUrl?.includes("basketball.exposureevents.com") ||
    event.officialUrl.includes("basketball.exposureevents.com")
  );
}

async function activeGamePriorityExposureIds(): Promise<Set<number>> {
  const events = await prisma.event.findMany({
    where: {
      AND: [
        courtWatchEventScopeWhere(),
        {
          externalProvider: "exposure_events",
          hasPublicTeamList: true,
          registeredTeamCount: { gt: 0 },
          status: { notIn: ["cancelled", "unavailable"] },
        },
      ],
    },
    select: {
      id: true,
      exposureEventId: true,
      city: true,
      state: true,
      location: true,
      region: true,
      startDate: true,
      endDate: true,
      lastCheckedAt: true,
      lastSyncedAt: true,
    },
  });
  const activeEvents = events.filter(
    (event) =>
      isCourtWatchSupportedTournamentRegion(event) &&
      eventIsInGameHydrationWindow(event),
  );
  if (activeEvents.length === 0) return new Set();

  const gameCounts = await prisma.game.groupBy({
    by: ["eventId"],
    where: { eventId: { in: activeEvents.map((event) => event.id) } },
    _count: { _all: true },
  });
  const countsByEventId = new Map(
    gameCounts.map((item) => [item.eventId, item._count._all]),
  );
  const now = Date.now();
  return new Set(
    activeEvents
      .filter((event) => {
        const gameCount = countsByEventId.get(event.id) ?? 0;
        if (gameCount === 0) return true;
        const lastDataAt = event.lastCheckedAt ?? event.lastSyncedAt;
        return (
          !lastDataAt ||
          now - lastDataAt.getTime() > env.WORKER_ACTIVE_GAME_STALE_MS
        );
      })
      .map((event) => event.exposureEventId),
  );
}

function eventIsInGameHydrationWindow(event: {
  startDate: Date;
  endDate: Date;
}) {
  const todayKey = dateKeyInPacific(new Date());
  const startKey = event.startDate.toISOString().slice(0, 10);
  const endKey = addDaysKey(event.endDate.toISOString().slice(0, 10), 3);
  return todayKey >= startKey && todayKey <= endKey;
}

function dateKeyInPacific(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
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

function preferredExposureEventIds() {
  const ids = new Set<number>();
  for (const source of DEFAULT_MAJOR_TOURNAMENT_SOURCES) {
    for (const url of source.eventUrls ?? []) {
      const id = exposureEventIdFromUrl(url);
      if (id) ids.add(id);
    }
  }
  ids.add(255539);
  return ids;
}

function exposureEventIdFromUrl(url: string) {
  const match = url.match(/exposureevents\.com\/(\d+)\//i);
  return match ? Number(match[1]) : null;
}

async function discoverTournamentsIfDue() {
  const intervalMs = env.TOURNAMENT_DISCOVERY_INTERVAL_HOURS * 60 * 60 * 1000;
  if (Date.now() - lastDiscoveryAt < intervalMs) return;

  const result = await new TournamentDiscoveryService().discover(
    DEFAULT_MAJOR_TOURNAMENT_SOURCES,
    { windowDays: env.TOURNAMENT_DISCOVERY_WINDOW_DAYS },
  );
  let upsertedCount = 0;
  for (const candidate of result.candidates) {
    await upsertDiscoveredEvent(candidate.event);
    upsertedCount += 1;
  }
  lastDiscoveryAt = Date.now();

  for (const failure of result.failures) {
    logger.warn(failure, "tournament discovery source skipped");
  }

  logger.info(
    {
      discoveredCount: result.candidates.length,
      upsertedCount,
      failureCount: result.failures.length,
    },
    "tournament discovery completed",
  );
}

async function upsertDiscoveredEvent(event: TournamentEvent) {
  await prisma.event.upsert({
    where: { exposureEventId: event.exposureEventId },
    update: {
      externalProvider: event.externalProvider,
      externalId: event.externalId,
      sourceUrl: event.sourceUrl,
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
      startDate: new Date(`${event.startDate}T00:00:00.000Z`),
      endDate: new Date(`${event.endDate}T00:00:00.000Z`),
      location: event.location,
      officialUrl: event.officialUrl,
      registeredTeamCount:
        event.registeredTeamCount > 0 ? event.registeredTeamCount : undefined,
      hasPublicTeamList: event.hasPublicTeamList || undefined,
      lastCheckedAt: event.lastCheckedAt
        ? new Date(event.lastCheckedAt)
        : undefined,
      lastTeamChangeAt: event.lastTeamChangeAt
        ? new Date(event.lastTeamChangeAt)
        : undefined,
      status: event.status,
    },
    create: {
      id: event.id,
      exposureEventId: event.exposureEventId,
      externalProvider: event.externalProvider,
      externalId: event.externalId,
      sourceUrl: event.sourceUrl,
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
      startDate: new Date(`${event.startDate}T00:00:00.000Z`),
      endDate: new Date(`${event.endDate}T00:00:00.000Z`),
      location: event.location,
      officialUrl: event.officialUrl,
      registeredTeamCount: event.registeredTeamCount,
      hasPublicTeamList: event.hasPublicTeamList,
      lastCheckedAt: event.lastCheckedAt ? new Date(event.lastCheckedAt) : null,
      lastSyncedAt: event.lastSyncedAt ? new Date(event.lastSyncedAt) : null,
      lastTeamChangeAt: event.lastTeamChangeAt
        ? new Date(event.lastTeamChangeAt)
        : null,
      status: event.status,
    },
  });
}

async function loop() {
  while (!shuttingDown) {
    try {
      const result = await syncOnce();
      failureCount = 0;
      logger.info(result, "sync completed");
    } catch (error) {
      failureCount += 1;
      logger.error(
        { error: error instanceof Error ? error.message : error, failureCount },
        "sync failed",
      );
    }

    const delay = calculatePollDelayMs({
      failureCount,
      activeOverride: await activeTournamentOverride(),
    });
    logger.info({ delayMs: delay, failureCount }, "waiting for next sync");
    await sleep(delay);
  }
}

async function activeTournamentOverride(): Promise<boolean | undefined> {
  try {
    const response = await fetchWithTimeout(
      new URL("/api/events", env.API_BASE_URL),
    );
    if (!response.ok) return undefined;
    const events = (await response.json()) as TournamentEvent[];
    return isAnyActiveTournamentWindow(events);
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : error },
      "active tournament window check failed",
    );
    return undefined;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(
    Math.max(1, Math.floor(concurrency)),
    items.length,
  );
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(
          items[currentIndex]!,
          currentIndex,
        );
      }
    }),
  );
  return results;
}

async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = env.WORKER_API_TIMEOUT_MS,
) {
  if (init.signal || timeoutMs <= 0) return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

logger.info({ apiBaseUrl: env.API_BASE_URL }, "starting worker");
void loop();
