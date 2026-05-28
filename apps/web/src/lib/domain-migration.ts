import {
  COURTWATCH_CLIENT_ID_KEY,
  DASHBOARD_FOLLOW_MIGRATION_KEY,
  SELECTED_EVENT_STORAGE_KEY,
  dashboardFollowMigrationStorageKey,
  divisionCompareStorageKey,
} from "./storage-keys";

const OFFICIAL_WEB_ORIGIN = "https://www.courtwatchaau.com";
const MIGRATION_HASH_KEY = "cw-migrate";
const LEGACY_WEB_HOSTS = new Set([
  "courtwatch-reno-web.onrender.com",
  "app.courtwatchaau.com",
]);

type DomainMigrationPayload = {
  version: 1;
  sourceHost: string;
  clientId?: string;
  selectedEventId?: string;
  divisionCompareKeys?: string[];
  followedTeamIds?: string[];
  createdAt: string;
};

export function isLegacyMigrationHost(hostname = currentHostname()): boolean {
  return LEGACY_WEB_HOSTS.has(hostname);
}

export function buildLegacyDomainMigrationUrl(): string {
  const payload = collectLegacyDomainMigrationPayload();
  const target = new URL(OFFICIAL_WEB_ORIGIN);
  target.hash = `${MIGRATION_HASH_KEY}=${encodeURIComponent(encodePayload(payload))}`;
  return target.toString();
}

export function applyIncomingDomainMigration(): boolean {
  if (typeof window === "undefined") return false;

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) return false;

  const params = new URLSearchParams(hash);
  const rawPayload = params.get(MIGRATION_HASH_KEY);
  if (!rawPayload) return false;

  const payload = decodePayload(rawPayload);
  if (!payload) return false;

  try {
    if (payload.clientId) {
      window.localStorage.setItem(COURTWATCH_CLIENT_ID_KEY, payload.clientId);
    }
    if (payload.selectedEventId) {
      window.localStorage.setItem(
        SELECTED_EVENT_STORAGE_KEY,
        payload.selectedEventId,
      );
    }
    if (payload.clientId && payload.divisionCompareKeys?.length) {
      window.localStorage.setItem(
        divisionCompareStorageKey(payload.clientId),
        JSON.stringify(payload.divisionCompareKeys),
      );
    }
    if (payload.followedTeamIds?.length) {
      window.localStorage.setItem(
        payload.clientId
          ? dashboardFollowMigrationStorageKey(payload.clientId)
          : DASHBOARD_FOLLOW_MIGRATION_KEY,
        JSON.stringify({
          teamIds: payload.followedTeamIds,
          sourceHost: payload.sourceHost,
          savedAt: new Date().toISOString(),
        }),
      );
    }
    window.localStorage.setItem(
      "courtwatch:domain-migration:received",
      JSON.stringify({
        sourceHost: payload.sourceHost,
        receivedAt: new Date().toISOString(),
      }),
    );
  } catch {
    return false;
  } finally {
    params.delete(MIGRATION_HASH_KEY);
    const cleanHash = params.toString();
    window.history.replaceState(
      window.history.state,
      document.title,
      `${window.location.pathname}${window.location.search}${cleanHash ? `#${cleanHash}` : ""}`,
    );
  }

  return true;
}

function collectLegacyDomainMigrationPayload(): DomainMigrationPayload {
  const clientId = readStorage(COURTWATCH_CLIENT_ID_KEY) ?? undefined;
  return {
    version: 1,
    sourceHost: currentHostname(),
    clientId,
    selectedEventId: readStorage(SELECTED_EVENT_STORAGE_KEY) ?? undefined,
    divisionCompareKeys: clientId
      ? readJsonArray(divisionCompareStorageKey(clientId))
      : [],
    followedTeamIds: readFollowedTeamIds(),
    createdAt: new Date().toISOString(),
  };
}

function currentHostname(): string {
  return typeof window === "undefined" ? "" : window.location.hostname;
}

function readFollowedTeamIds(): string[] {
  const clientId = readStorage(COURTWATCH_CLIENT_ID_KEY);
  const migrationIds = readJsonTeamIds(
    clientId
      ? (readStorage(dashboardFollowMigrationStorageKey(clientId)) ??
          readStorage(DASHBOARD_FOLLOW_MIGRATION_KEY))
      : readStorage(DASHBOARD_FOLLOW_MIGRATION_KEY),
  );
  if (migrationIds.length > 0) return migrationIds;

  const ids = new Set<string>();
  for (const key of storageKeys()) {
    if (!isDashboardCacheKey(key) && !key.includes(":followed-teams:"))
      continue;
    const raw = readStorage(key);
    const teamIds = key.includes(":followed-teams:")
      ? storedFollowedTeamIds(raw)
      : dashboardTeamIds(raw);
    for (const teamId of teamIds) ids.add(teamId);
  }
  return Array.from(ids);
}

function isDashboardCacheKey(key: string): boolean {
  return (
    key === "courtwatch:dashboard" ||
    key.startsWith("courtwatch-reno:dashboard:") ||
    (key.startsWith("courtwatch-aau:") && key.includes(":dashboard:"))
  );
}

function dashboardTeamIds(raw: string | null): string[] {
  const parsed = parseJson(raw);
  const data = isRecord(parsed) && "data" in parsed ? parsed.data : parsed;
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

function readJsonTeamIds(raw: string | null): string[] {
  const parsed = parseJson(raw);
  if (!isRecord(parsed) || !Array.isArray(parsed.teamIds)) return [];
  return parsed.teamIds.filter(
    (teamId): teamId is string => typeof teamId === "string",
  );
}

function storedFollowedTeamIds(raw: string | null): string[] {
  const parsed = parseJson(raw);
  if (!isRecord(parsed) || !Array.isArray(parsed.teams)) return [];
  return parsed.teams
    .map((team) =>
      isRecord(team) && typeof team.id === "string" ? team.id : null,
    )
    .filter((teamId): teamId is string => Boolean(teamId));
}

function readJsonArray(key: string): string[] {
  const parsed = parseJson(readStorage(key));
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageKeys(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ).filter((key): key is string => Boolean(key));
  } catch {
    return [];
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function encodePayload(payload: DomainMigrationPayload): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

function decodePayload(value: string): DomainMigrationPayload | null {
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(value));
    const parsed = JSON.parse(json) as Partial<DomainMigrationPayload>;
    if (parsed.version !== 1 || typeof parsed.sourceHost !== "string")
      return null;
    return {
      version: 1,
      sourceHost: parsed.sourceHost,
      clientId:
        typeof parsed.clientId === "string" ? parsed.clientId : undefined,
      selectedEventId:
        typeof parsed.selectedEventId === "string"
          ? parsed.selectedEventId
          : undefined,
      divisionCompareKeys: Array.isArray(parsed.divisionCompareKeys)
        ? parsed.divisionCompareKeys.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      followedTeamIds: Array.isArray(parsed.followedTeamIds)
        ? parsed.followedTeamIds.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      createdAt:
        typeof parsed.createdAt === "string"
          ? parsed.createdAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "=",
  );
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
