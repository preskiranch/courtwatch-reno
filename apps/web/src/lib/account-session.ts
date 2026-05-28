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

export function loadAccountSession(): AccountSession | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(ACCOUNT_SESSION_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<AccountSession>;
    if (
      typeof parsed.token !== "string" ||
      !parsed.user ||
      typeof parsed.user.id !== "string" ||
      typeof parsed.user.email !== "string"
    )
      return null;
    return parsed as AccountSession;
  } catch {
    return null;
  }
}

export function saveAccountSession(session: AccountSession): AccountSession {
  if (typeof window !== "undefined")
    window.localStorage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify(session));
  return session;
}

export function clearAccountSession() {
  if (typeof window !== "undefined")
    window.localStorage.removeItem(ACCOUNT_SESSION_KEY);
}

export function accountAuthToken(): string | null {
  return loadAccountSession()?.token ?? null;
}
