import type { Team } from "@courtwatch/core";

type StoredFollowedTeams = {
  savedAt: string;
  teams: Team[];
};

const STORAGE_VERSION = "v1";

export function loadStoredFollowedTeams(
  clientId: string | null,
  eventId: number | null,
): Team[] {
  const key = followedTeamsStorageKey(clientId, eventId);
  if (!key || typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as Partial<StoredFollowedTeams>;
    if (!Array.isArray(parsed.teams)) return [];
    return parsed.teams
      .filter(isStoredTeam)
      .map((team) => ({ ...team, isFollowed: true }));
  } catch {
    return [];
  }
}

export function mergeStoredFollowedTeams(
  clientId: string | null,
  eventId: number | null,
  teams: Team[],
  options: { onlyExistingWhenStored?: boolean } = {},
): Team[] {
  const current = loadStoredFollowedTeams(clientId, eventId);
  const currentIds = new Set(current.map((team) => team.id));
  const followedTeams = teams
    .filter((team) => team.isFollowed)
    .filter(
      (team) => !options.onlyExistingWhenStored || currentIds.has(team.id),
    );
  if (followedTeams.length === 0) {
    return current;
  }
  return writeStoredFollowedTeams(clientId, eventId, (current) =>
    mergeTeamLists(current, followedTeams.map(markFollowed)),
  );
}

export function replaceStoredFollowedTeams(
  clientId: string | null,
  eventId: number | null,
  teams: Team[],
): Team[] {
  return writeStoredFollowedTeams(clientId, eventId, () =>
    teams.filter((team) => team.isFollowed).map(markFollowed),
  );
}

export function rememberStoredFollowedTeam(
  clientId: string | null,
  eventId: number | null,
  team: Team | undefined,
): Team[] {
  if (!team) return loadStoredFollowedTeams(clientId, eventId);
  return writeStoredFollowedTeams(clientId, eventId, (current) =>
    mergeTeamLists(current, [markFollowed(team)]),
  );
}

export function forgetStoredFollowedTeam(
  clientId: string | null,
  eventId: number | null,
  teamId: string,
): Team[] {
  return writeStoredFollowedTeams(clientId, eventId, (current) =>
    current.filter((team) => team.id !== teamId),
  );
}

export function mergeTeamLists(...lists: Team[][]): Team[] {
  const teamsById = new Map<string, Team>();
  for (const list of lists) {
    for (const team of list) {
      const existing = teamsById.get(team.id);
      teamsById.set(team.id, mergeTeam(existing, team));
    }
  }
  return Array.from(teamsById.values());
}

function writeStoredFollowedTeams(
  clientId: string | null,
  eventId: number | null,
  update: (current: Team[]) => Team[],
): Team[] {
  const key = followedTeamsStorageKey(clientId, eventId);
  const current = loadStoredFollowedTeams(clientId, eventId);
  const next = update(current).map(markFollowed);
  if (!key || typeof window === "undefined") return next;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ savedAt: new Date().toISOString(), teams: next }),
    );
  } catch {
    // Keep the in-memory view correct even when private browsing blocks writes.
  }
  return next;
}

function followedTeamsStorageKey(
  clientId: string | null,
  eventId: number | null,
): string | null {
  if (!clientId || !eventId) return null;
  return `courtwatch-aau:${STORAGE_VERSION}:followed-teams:${encodeURIComponent(
    clientId,
  )}:${eventId}`;
}

function markFollowed(team: Team): Team {
  return { ...team, isFollowed: true };
}

function mergeTeam(existing: Team | undefined, incoming: Team): Team {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    followerCount: incoming.followerCount ?? existing.followerCount,
    record: incoming.record ?? existing.record,
    isFollowed: Boolean(existing.isFollowed || incoming.isFollowed),
  };
}

function isStoredTeam(value: unknown): value is Team {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const team = value as Partial<Team>;
  return (
    typeof team.id === "string" &&
    typeof team.eventId === "string" &&
    typeof team.name === "string" &&
    typeof team.normalizedName === "string" &&
    typeof team.lastSeenAt === "string"
  );
}
