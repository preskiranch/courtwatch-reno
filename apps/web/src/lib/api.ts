import type { DashboardResponse, DivisionResultGroup, Game, GameChangeEvent, ProgramAlias, ProgramSummary, ProgramTeamMatch, Team, TournamentEvent } from "@courtwatch/core";
import { stableClientId } from "./client-id";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.API_BASE_URL || "http://localhost:4000";

type CacheKey = "dashboard" | "games" | "alerts" | "programs" | "event" | "results" | "resultsAll";

export type PresenceResponse = {
  activeUsers: number;
  pages: Record<string, number>;
  clientId: string | null;
  updatedAt: string;
};

export async function apiGet<T>(path: string, cacheKey?: CacheKey): Promise<T> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Accept: "application/json", ...clientIdentityHeaders() },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    const data = (await response.json()) as T;
    if (cacheKey && typeof window !== "undefined") {
      preserveDashboardFollowsForMigration(cacheKey, window.localStorage.getItem(`courtwatch:${cacheKey}`), data);
      window.localStorage.setItem(`courtwatch:${cacheKey}`, JSON.stringify({ data, savedAt: new Date().toISOString() }));
    }
    return data;
  } catch (error) {
    if (cacheKey && typeof window !== "undefined") {
      const cached = window.localStorage.getItem(`courtwatch:${cacheKey}`);
      if (cached) return (JSON.parse(cached) as { data: T }).data;
    }
    throw error;
  }
}

export async function apiPost<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...clientIdentityHeaders(), ...headers },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

export async function apiDelete(path: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: "DELETE", headers: { Accept: "application/json", ...clientIdentityHeaders() } });
  if (!response.ok) throw new Error(await response.text());
}

export const CourtWatchApi = {
  dashboard: () => apiGet<DashboardResponse>("/api/dashboard", "dashboard"),
  event: () => apiGet<TournamentEvent>("/api/events/current", "event"),
  programs: () => apiGet<ProgramSummary[]>("/api/programs", "programs"),
  games: (query = "") => apiGet<Game[]>(`/api/games${query}`, "games"),
  results: (scope: "watched" | "all" = "watched") => apiGet<DivisionResultGroup[]>(`/api/results?scope=${scope}`, scope === "all" ? "resultsAll" : "results"),
  alerts: () => apiGet<GameChangeEvent[]>("/api/alerts", "alerts"),
  teams: (search = "") => apiGet<Team[]>(`/api/teams${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  presence: () => apiGet<PresenceResponse>("/api/presence"),
  presenceHeartbeat: (clientId: string, page: string) => apiPost<PresenceResponse>("/api/presence/heartbeat", { clientId, page }),
  followTeam: (teamId: string) => apiPost<ProgramTeamMatch>(`/api/teams/${teamId}/follow`, {}),
  unfollowTeam: (teamId: string) => apiDelete(`/api/teams/${teamId}/follow`),
  addAlias: (programId: string, alias: string) => apiPost<ProgramAlias>(`/api/programs/${programId}/aliases`, { alias }),
  deleteAlias: (programId: string, aliasId: string) => apiDelete(`/api/programs/${programId}/aliases/${aliasId}`),
  subscribePush: (subscription: PushSubscription, timezone: string) => apiPost<{ ok: boolean; userId?: string }>("/api/push/subscribe", { subscription, timezone }),
  syncNow: (adminSecret: string) => apiPost<{ status: string; teamsCount: number; gamesCount: number; changesDetected: number }>("/api/admin/sync-now", {}, { "x-admin-secret": adminSecret })
};

export function apiBaseUrl() {
  return API_BASE_URL;
}

function clientIdentityHeaders(): Record<string, string> {
  const clientId = stableClientId();
  return clientId ? { "x-courtwatch-client-id": clientId } : {};
}

function preserveDashboardFollowsForMigration<T>(cacheKey: CacheKey, previousCache: string | null, nextData: T) {
  if (cacheKey !== "dashboard" || !previousCache || typeof window === "undefined") return;
  const previousTeamIds = dashboardTeamIdsFromUnknown(safeJson(previousCache));
  const nextTeamIds = dashboardTeamIdsFromUnknown(nextData);
  if (previousTeamIds.length > 0 && nextTeamIds.length === 0) {
    window.localStorage.setItem("courtwatch:dashboard-follow-migration", JSON.stringify({ teamIds: previousTeamIds, savedAt: new Date().toISOString() }));
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
