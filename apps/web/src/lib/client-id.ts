import { applyIncomingDomainMigration } from "./domain-migration";
import { COURTWATCH_CLIENT_ID_KEY } from "./storage-keys";

export { COURTWATCH_CLIENT_ID_KEY };

export function stableClientId(): string | null {
  if (typeof window === "undefined") return null;
  applyIncomingDomainMigration();
  const generated =
    window.crypto?.randomUUID?.() ??
    `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    const existing = window.localStorage.getItem(COURTWATCH_CLIENT_ID_KEY);
    if (existing) return existing;
    window.localStorage.setItem(COURTWATCH_CLIENT_ID_KEY, generated);
  } catch {
    return generated;
  }
  return generated;
}
