import type {
  DashboardResponse,
  DivisionResultGroup,
  Game,
  GameChangeEvent,
  ProgramAlias,
  ProgramSummary,
  ProgramTeamMatch,
  Team,
  TeamScoringLeader,
  TournamentEvent,
} from "@courtwatch/core";
import { stableClientId } from "./client-id";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.API_BASE_URL ||
  "http://localhost:4000";

type CacheKey =
  | "dashboard"
  | "games"
  | "gamesAll"
  | "alerts"
  | "programs"
  | "pointsLeaders"
  | "event"
  | "events"
  | "results"
  | "resultsAll"
  | "teams";

const CACHE_VERSION = "v16";
const LEGACY_CACHE_VERSION = "v15";
const DEVICE_SCOPED_CACHE_KEYS = new Set<CacheKey>([
  "dashboard",
  "games",
  "alerts",
  "programs",
  "results",
  "teams",
]);

export type PresenceResponse = {
  activeUsers: number;
  pages: Record<string, number>;
  clientId: string | null;
  updatedAt: string;
};

export async function apiGet<T>(path: string, cacheKey?: CacheKey): Promise<T> {
  const clientId = stableClientId();
  const storageKey = cacheKey
    ? cacheStorageKey(cacheKey, path, clientId)
    : null;
  const cacheKeys = cacheKey
    ? cacheLookupKeys(cacheKey, path, clientId)
    : [];
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        Accept: "application/json",
        ...clientIdentityHeaders(clientId),
      },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    const data = (await response.json()) as T;
    const previousCache =
      cacheKey && storageKey && typeof window !== "undefined"
        ? firstCachedValue(cacheKeys)
        : null;
    const dataToStore = mergeCacheData(
      cacheKey,
      cachedDataFromString(previousCache),
      data,
    );
    if (cacheKey && storageKey && typeof window !== "undefined") {
      preserveDashboardFollowsForMigration(
        cacheKey,
        previousCache,
        dataToStore,
        clientId,
      );
      if (shouldPersistCacheData(cacheKey, dataToStore)) {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            data: dataToStore,
            savedAt: new Date().toISOString(),
          }),
        );
      }
    }
    return dataToStore;
  } catch (error) {
    if (storageKey && typeof window !== "undefined") {
      const cached = firstCachedValue(cacheKeys);
      if (cached) return (JSON.parse(cached) as { data: T }).data;
    }
    throw error;
  }
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...clientIdentityHeaders(),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

export async function apiDelete(path: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "DELETE",
    headers: { Accept: "application/json", ...clientIdentityHeaders() },
  });
  if (!response.ok) throw new Error(await response.text());
}

export const CourtWatchApi = {
  events: () => apiGet<TournamentEvent[]>("/api/events", "events"),
  dashboard: (eventId?: number | null) =>
    apiGet<DashboardResponse>(
      withEvent("/api/dashboard", eventId),
      "dashboard",
    ),
  event: (eventId?: number | null) =>
    apiGet<TournamentEvent>(withEvent("/api/events/current", eventId), "event"),
  programs: (eventId?: number | null) =>
    apiGet<ProgramSummary[]>(withEvent("/api/programs", eventId), "programs"),
  games: (query = "", eventId?: number | null) =>
    apiGet<Game[]>(withEvent(`/api/games${query}`, eventId), "games"),
  allGames: (eventId?: number | null) =>
    apiGet<Game[]>(withEvent("/api/games?scope=all", eventId), "gamesAll"),
  results: (scope: "watched" | "all" = "watched", eventId?: number | null) =>
    apiGet<DivisionResultGroup[]>(
      withEvent(`/api/results?scope=${scope}`, eventId),
      scope === "all" ? "resultsAll" : "results",
    ),
  alerts: (eventId?: number | null) =>
    apiGet<GameChangeEvent[]>(withEvent("/api/alerts", eventId), "alerts"),
  teams: (search = "", eventId?: number | null) =>
    apiGet<Team[]>(
      withEvent(
        `/api/teams${search ? `?search=${encodeURIComponent(search)}` : ""}`,
        eventId,
      ),
      search ? undefined : "teams",
    ),
  pointsLeaders: (eventId?: number | null) =>
    apiGet<TeamScoringLeader[]>(
      withEvent("/api/points-leaders", eventId),
    ),
  presence: () => apiGet<PresenceResponse>("/api/presence"),
  presenceHeartbeat: (clientId: string, page: string) =>
    apiPost<PresenceResponse>("/api/presence/heartbeat", { clientId, page }),
  followTeam: (teamId: string) =>
    apiPost<ProgramTeamMatch>(`/api/teams/${teamId}/follow`, {}),
  unfollowTeam: (teamId: string) => apiDelete(`/api/teams/${teamId}/follow`),
  addAlias: (programId: string, alias: string) =>
    apiPost<ProgramAlias>(`/api/programs/${programId}/aliases`, { alias }),
  deleteAlias: (programId: string, aliasId: string) =>
    apiDelete(`/api/programs/${programId}/aliases/${aliasId}`),
  subscribePush: (subscription: PushSubscription, timezone: string) =>
    apiPost<{ ok: boolean; userId?: string }>("/api/push/subscribe", {
      subscription,
      timezone,
    }),
  syncNow: (adminSecret: string, eventId?: number | null) =>
    apiPost<{
      status: string;
      teamsCount: number;
      gamesCount: number;
      changesDetected: number;
    }>(
      withEvent("/api/admin/sync-now", eventId),
      {},
      { "x-admin-secret": adminSecret },
    ),
  discoverTournaments: (adminSecret: string) =>
    apiPost<{
      status: string;
      discoveredCount: number;
      syncedCount: number;
      failures: Array<{ provider: string; source: string; message: string }>;
    }>(
      "/api/admin/discover-tournaments",
      {},
      { "x-admin-secret": adminSecret },
    ),
};

export function apiBaseUrl() {
  return API_BASE_URL;
}

function clientIdentityHeaders(
  clientId: string | null = stableClientId(),
): Record<string, string> {
  return clientId ? { "x-courtwatch-client-id": clientId } : {};
}

function withEvent(path: string, eventId?: number | null): string {
  if (!eventId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}eventId=${encodeURIComponent(String(eventId))}`;
}

function cacheStorageKey(
  cacheKey: CacheKey,
  path: string,
  clientId: string | null,
): string {
  const scope =
    clientId && DEVICE_SCOPED_CACHE_KEYS.has(cacheKey)
      ? `:${encodeURIComponent(clientId)}`
      : "";
  return `courtwatch-aau:${CACHE_VERSION}${scope}:${cacheKey}:${path}`;
}

function cacheLookupKeys(
  cacheKey: CacheKey,
  path: string,
  clientId: string | null,
): string[] {
  const keys = [cacheStorageKey(cacheKey, path, clientId)];
  if (!DEVICE_SCOPED_CACHE_KEYS.has(cacheKey) || cacheKey === "dashboard") {
    keys.push(
      `courtwatch-aau:${LEGACY_CACHE_VERSION}:${cacheKey}:${path}`,
      `courtwatch:${cacheKey}`,
    );
  }
  return keys;
}

function firstCachedValue(keys: string[]): string | null {
  if (typeof window === "undefined") return null;
  for (const key of keys) {
    const value = window.localStorage.getItem(key);
    if (value) return value;
  }
  return null;
}

function shouldPersistCacheData<T>(cacheKey: CacheKey, data: T): boolean {
  if (!Array.isArray(data)) return true;
  if (cacheKey === "events") return data.length > 0;
  if (
    ["pointsLeaders", "teams", "gamesAll", "resultsAll"].includes(cacheKey)
  ) {
    return data.length > 0;
  }
  return true;
}

function mergeCacheData<T>(
  cacheKey: CacheKey | undefined,
  previousData: unknown,
  nextData: T,
): T {
  if (cacheKey !== "events" || !Array.isArray(nextData)) return nextData;
  return mergeTournamentEvents(previousData, nextData) as T;
}

function mergeTournamentEvents(
  previousData: unknown,
  nextData: unknown[],
): TournamentEvent[] {
  const previousEvents = Array.isArray(previousData)
    ? previousData.filter(isTournamentEvent)
    : [];
  const nextEvents = nextData.filter(isTournamentEvent);
  const merged = new Map<number, TournamentEvent>();
  for (const event of previousEvents) {
    if (eventStillSelectable(event)) merged.set(event.exposureEventId, event);
  }
  for (const event of nextEvents) {
    if (eventStillSelectable(event)) merged.set(event.exposureEventId, event);
  }
  return Array.from(merged.values()).sort(compareTournamentEvents);
}

function eventStillSelectable(event: TournamentEvent): boolean {
  if (event.status === "cancelled" || event.status === "unavailable")
    return false;
  const today = localDateKey();
  const oldestVisibleEnd = addDaysToDateKey(today, -7);
  const newestVisibleStart = addDaysToDateKey(today, 183);
  return (
    event.endDate >= oldestVisibleEnd && event.startDate <= newestVisibleStart
  );
}

function compareTournamentEvents(
  left: TournamentEvent,
  right: TournamentEvent,
): number {
  return (
    left.startDate.localeCompare(right.startDate) ||
    left.name.localeCompare(right.name, "en-US", {
      numeric: true,
      sensitivity: "base",
    })
  );
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return localDateKey(new Date(year, month - 1, day + days, 12));
}

function preserveDashboardFollowsForMigration<T>(
  cacheKey: CacheKey,
  previousCache: string | null,
  nextData: T,
  clientId: string | null,
) {
  if (
    cacheKey !== "dashboard" ||
    !previousCache ||
    !clientId ||
    typeof window === "undefined"
  )
    return;
  const previousTeamIds = dashboardTeamIdsFromUnknown(safeJson(previousCache));
  const nextTeamIds = dashboardTeamIdsFromUnknown(nextData);
  if (previousTeamIds.length > 0 && nextTeamIds.length === 0) {
    window.localStorage.setItem(
      `courtwatch:dashboard-follow-migration:${encodeURIComponent(clientId)}`,
      JSON.stringify({
        teamIds: previousTeamIds,
        savedAt: new Date().toISOString(),
      }),
    );
  }
}

function dashboardTeamIdsFromUnknown(value: unknown): string[] {
  const data = isRecord(value) && "data" in value ? value.data : value;
  if (!isRecord(data) || !Array.isArray(data.programs)) return [];
  const ids = new Set<string>();
  for (const program of data.programs) {
    if (!isRecord(program) || !Array.isArray(program.teams)) continue;
    for (const team of program.teams) {
      if (isRecord(team) && typeof team.id === "string") ids.add(team.id);
    }
  }
  return Array.from(ids);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cachedDataFromString(value: string | null): unknown {
  if (!value) return null;
  const parsed = safeJson(value);
  return isRecord(parsed) && "data" in parsed ? parsed.data : parsed;
}

function isTournamentEvent(value: unknown): value is TournamentEvent {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.exposureEventId === "number" &&
    typeof value.name === "string" &&
    typeof value.startDate === "string" &&
    typeof value.endDate === "string"
  );
}
