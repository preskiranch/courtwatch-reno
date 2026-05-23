import { RENO_TIMEZONE } from "./types.js";

export function isActiveTournamentWindow(now = new Date()): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: RENO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const inDates = dateKey >= "2026-05-23" && dateKey <= "2026-05-25";
  const inHours = hour >= 6 && (hour < 23 || (hour === 23 && minute <= 30));
  return inDates && inHours;
}

export function calculatePollDelayMs(options: { now?: Date; failureCount: number; activeOverride?: boolean }): number {
  const active = options.activeOverride ?? isActiveTournamentWindow(options.now ?? new Date());
  const base = active ? 60_000 : 12 * 60_000;
  if (options.failureCount <= 0) return base;
  const backoff = Math.min(base * 2 ** options.failureCount, 15 * 60_000);
  return Math.max(base, backoff);
}
