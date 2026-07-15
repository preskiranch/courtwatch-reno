export function notificationClickUrl({
  webBaseUrl,
  exposureEventId,
  gameId,
  tab,
}: {
  webBaseUrl: string;
  exposureEventId: number | null;
  gameId: string | null;
  tab?: "dashboard" | "schedule" | "teams" | "alerts";
}): string {
  const fallbackBaseUrl = "https://www.courtwatchaau.com";
  let url: URL;
  try {
    url = new URL("/", webBaseUrl || fallbackBaseUrl);
  } catch {
    url = new URL("/", fallbackBaseUrl);
  }

  if (exposureEventId) {
    url.searchParams.set("eventId", String(exposureEventId));
  }
  url.searchParams.set(
    "tab",
    tab ?? (gameId ? "schedule" : exposureEventId ? "alerts" : "dashboard"),
  );
  if (gameId) {
    url.searchParams.set("gameId", gameId);
  }
  return url.toString();
}
