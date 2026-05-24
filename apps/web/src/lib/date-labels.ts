export const RENO_TIME_ZONE = "America/Los_Angeles";

export function dateKeyInReno(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: RENO_TIME_ZONE,
    year: "numeric"
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function scheduleDateSectionLabel(dateKey: string, todayKey: string = dateKeyInReno()): string {
  if (dateKey === todayKey) return "Today";
  if (dateKey === addDaysToDateKey(todayKey, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: RENO_TIME_ZONE,
    weekday: "long"
  }).format(new Date(`${dateKey}T12:00:00.000Z`));
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}
