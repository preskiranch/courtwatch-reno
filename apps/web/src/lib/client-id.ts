export const COURTWATCH_CLIENT_ID_KEY = "courtwatch:presence-client-id";

export function stableClientId(): string | null {
  if (typeof window === "undefined") return null;
  const generated = window.crypto?.randomUUID?.() ?? `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    const existing = window.localStorage.getItem(COURTWATCH_CLIENT_ID_KEY);
    if (existing) return existing;
    window.localStorage.setItem(COURTWATCH_CLIENT_ID_KEY, generated);
  } catch {
    return generated;
  }
  return generated;
}
