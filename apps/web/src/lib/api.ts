import type { DashboardResponse, Game, GameChangeEvent, ProgramAlias, ProgramSummary, ProgramTeamMatch, Team, TournamentEvent } from "@courtwatch/core";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.API_BASE_URL || "http://localhost:4000";

type CacheKey = "dashboard" | "games" | "alerts" | "programs" | "event";

export type PresenceResponse = {
  activeUsers: number;
  pages: Record<string, number>;
  clientId: string | null;
  updatedAt: string;
};

export async function apiGet<T>(path: string, cacheKey?: CacheKey): Promise<T> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    const data = (await response.json()) as T;
    if (cacheKey && typeof window !== "undefined") {
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
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

export async function apiDelete(path: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await response.text());
}

export const CourtWatchApi = {
  dashboard: () => apiGet<DashboardResponse>("/api/dashboard", "dashboard"),
  event: () => apiGet<TournamentEvent>("/api/events/current", "event"),
  programs: () => apiGet<ProgramSummary[]>("/api/programs", "programs"),
  games: (query = "") => apiGet<Game[]>(`/api/games${query}`, "games"),
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
