export type AccountUser = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
};

export type AccountSession = {
  token: string;
  user: AccountUser;
  totalRegisteredUsers?: number;
};

const ACCOUNT_SESSION_KEY = "courtwatch-aau:account-session:v1";
const LEGACY_API_CACHE_KEYS = new Set([
  "courtwatch:dashboard",
  "courtwatch:games",
  "courtwatch:gamesAll",
  "courtwatch:courts",
  "courtwatch:alerts",
  "courtwatch:programs",
  "courtwatch:pointsLeaders",
  "courtwatch:accountStats",
  "courtwatch:syncStatus",
  "courtwatch:event",
  "courtwatch:events",
  "courtwatch:results",
  "courtwatch:resultsAll",
  "courtwatch:teams",
]);
const VERSIONED_API_CACHE_MARKERS = [
  ":dashboard:/api/",
  ":games:/api/",
  ":gamesAll:/api/",
  ":courts:/api/",
  ":alerts:/api/",
  ":programs:/api/",
  ":pointsLeaders:/api/",
  ":accountStats:/api/",
  ":syncStatus:/api/",
  ":event:/api/",
  ":events:/api/",
  ":results:/api/",
  ":resultsAll:/api/",
  ":teams:/api/",
] as const;

let volatileAccountSession: AccountSession | null = null;
let lastSessionSavePersisted = true;

export function loadAccountSession(): AccountSession | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(ACCOUNT_SESSION_KEY);
    if (!stored) return volatileAccountSession;
    const parsed = JSON.parse(stored) as Partial<AccountSession>;
    if (
      typeof parsed.token !== "string" ||
      !parsed.user ||
      typeof parsed.user.id !== "string" ||
      typeof parsed.user.email !== "string"
    )
      return volatileAccountSession;
    volatileAccountSession = parsed as AccountSession;
    return volatileAccountSession;
  } catch {
    return volatileAccountSession;
  }
}

export function saveAccountSession(session: AccountSession): AccountSession {
  volatileAccountSession = session;
  lastSessionSavePersisted = false;
  if (typeof window === "undefined") return session;

  const serialized = JSON.stringify(session);
  try {
    window.localStorage.setItem(ACCOUNT_SESSION_KEY, serialized);
    lastSessionSavePersisted = true;
    return session;
  } catch {
    clearDisposableApiCaches(window.localStorage);
  }

  try {
    window.localStorage.setItem(ACCOUNT_SESSION_KEY, serialized);
    lastSessionSavePersisted = true;
  } catch {
    // Keep the authenticated session in memory when browser storage is blocked.
  }
  return session;
}

export function clearAccountSession() {
  volatileAccountSession = null;
  lastSessionSavePersisted = true;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ACCOUNT_SESSION_KEY);
  } catch {
    // The in-memory session is already cleared.
  }
}

export function accountSessionIsPersistent(): boolean {
  return lastSessionSavePersisted;
}

export function isDisposableApiCacheKey(key: string): boolean {
  if (LEGACY_API_CACHE_KEYS.has(key)) return true;
  if (!key.startsWith("courtwatch-aau:v")) return false;
  return VERSIONED_API_CACHE_MARKERS.some((marker) => key.includes(marker));
}

export function accountAuthToken(): string | null {
  return loadAccountSession()?.token ?? null;
}

function clearDisposableApiCaches(storage: Storage) {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
  } catch {
    return;
  }

  for (const key of keys) {
    if (!isDisposableApiCacheKey(key)) continue;
    try {
      storage.removeItem(key);
    } catch {
      // Continue clearing any other disposable cache entries.
    }
  }
}
