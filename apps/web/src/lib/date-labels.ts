export const DEFAULT_TOURNAMENT_TIME_ZONE = "America/Los_Angeles";
export const RENO_TIME_ZONE = DEFAULT_TOURNAMENT_TIME_ZONE;

export function dateKeyInReno(date: Date = new Date()): string {
  return dateKeyInTimeZone(date, RENO_TIME_ZONE);
}

export function dateKeyInDefaultTimeZone(date: Date = new Date()): string {
  return dateKeyInTimeZone(date, DEFAULT_TOURNAMENT_TIME_ZONE);
}

export function dateKeyInTimeZone(
  date: Date = new Date(),
  timeZone = DEFAULT_TOURNAMENT_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function scheduleDateSectionLabel(
  dateKey: string,
  todayKey: string = dateKeyInReno(),
  timeZone = RENO_TIME_ZONE,
): string {
  if (dateKey === todayKey) return "Today";
  if (dateKey === addDaysToDateKey(todayKey, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "long",
  }).format(new Date(`${dateKey}T12:00:00.000Z`));
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}
