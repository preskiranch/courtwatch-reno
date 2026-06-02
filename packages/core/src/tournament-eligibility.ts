import type { TournamentEvent, TournamentEventStatus } from "./types.js";
import { DEFAULT_TOURNAMENT_TIMEZONE } from "./types.js";

export const UPCOMING_PUBLIC_TOURNAMENT_LOOKAHEAD_DAYS = 183;
export const UPCOMING_TOURNAMENT_WINDOW_DAYS =
  UPCOMING_PUBLIC_TOURNAMENT_LOOKAHEAD_DAYS;
export const DEFAULT_DROPDOWN_CACHE_HOURS = 720;
export const RECENT_COMPLETED_TOURNAMENT_DAYS = 90;

export interface TournamentDropdownEligibilityOptions {
  todayKey?: string;
  windowDays?: number;
  cacheHours?: number;
  now?: Date;
}

export function tournamentTodayKey(now = new Date()): string {
  return (
    process.env.COURTWATCH_TODAY?.trim() ||
    dateKeyInTimeZone(now, DEFAULT_TOURNAMENT_TIMEZONE)
  );
}

export function tournamentWindowEndKey(
  todayKey = tournamentTodayKey(),
  windowDays = UPCOMING_PUBLIC_TOURNAMENT_LOOKAHEAD_DAYS,
): string {
  return addDaysToDateKey(todayKey, windowDays);
}

export function deriveTournamentStatus(
  event: Pick<TournamentEvent, "startDate" | "endDate" | "status">,
  todayKey = tournamentTodayKey(),
): TournamentEventStatus {
  if (event.status === "cancelled" || event.status === "unavailable")
    return event.status;
  if (event.endDate < todayKey) return "completed";
  if (event.startDate <= todayKey && event.endDate >= todayKey) return "active";
  return "upcoming";
}

export function isTournamentDropdownEligible(
  event: TournamentEvent,
  options: TournamentDropdownEligibilityOptions = {},
): boolean {
  const todayKey = options.todayKey ?? tournamentTodayKey(options.now);
  const windowEndKey = tournamentWindowEndKey(
    todayKey,
    options.windowDays ?? UPCOMING_PUBLIC_TOURNAMENT_LOOKAHEAD_DAYS,
  );
  const status = deriveTournamentStatus(event, todayKey);
  const hasValidCache = hasRecentSuccessfulTournamentData(event, {
    now: options.now,
    cacheHours: options.cacheHours ?? DEFAULT_DROPDOWN_CACHE_HOURS,
  });
  const recentlyCompleted =
    status === "completed" &&
    event.endDate >=
      addDaysToDateKey(todayKey, -RECENT_COMPLETED_TOURNAMENT_DAYS);

  return (
    (status === "upcoming" || status === "active" || recentlyCompleted) &&
    (event.endDate >= todayKey || recentlyCompleted) &&
    event.startDate <= windowEndKey &&
    event.hasPublicTeamList &&
    hasValidCache
  );
}

export function eligibleTournamentEvents(
  events: TournamentEvent[],
  options: TournamentDropdownEligibilityOptions = {},
): TournamentEvent[] {
  const seen = new Set<string>();
  const deduped: TournamentEvent[] = [];
  for (const event of events) {
    const key = tournamentDedupeKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    if (isTournamentDropdownEligible(event, options))
      deduped.push({
        ...event,
        status: deriveTournamentStatus(
          event,
          options.todayKey ?? tournamentTodayKey(options.now),
        ),
      });
  }
  return deduped.sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) ||
      left.name.localeCompare(right.name),
  );
}

export function hasRecentSuccessfulTournamentData(
  event: Pick<TournamentEvent, "lastSyncedAt" | "lastCheckedAt">,
  options: Pick<
    TournamentDropdownEligibilityOptions,
    "cacheHours" | "now"
  > = {},
): boolean {
  const reference = event.lastSyncedAt ?? event.lastCheckedAt;
  if (!reference) return false;
  const checkedAt = Date.parse(reference);
  if (!Number.isFinite(checkedAt)) return false;
  const cacheMs =
    (options.cacheHours ?? DEFAULT_DROPDOWN_CACHE_HOURS) * 60 * 60 * 1000;
  return (options.now ?? new Date()).getTime() - checkedAt <= cacheMs;
}

export function tournamentDedupeKey(event: TournamentEvent): string {
  if (event.externalProvider && event.externalId)
    return `${event.externalProvider}:${event.externalId}`.toLowerCase();
  return [event.name, event.startDate, event.city, event.state, event.organizer]
    .map((part) => normalizeKey(part ?? ""))
    .join("|");
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return new Date(Date.UTC(year, month - 1, day + days, 12))
    .toISOString()
    .slice(0, 10);
}

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
