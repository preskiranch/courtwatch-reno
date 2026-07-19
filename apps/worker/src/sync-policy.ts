export type SyncMode = "full" | "teams";

export interface SyncSignals {
  activeGamePriority: boolean;
  needsPublishedTeamHydration: boolean;
  needsActiveEventRefresh: boolean;
  needsPublicTeamListRecheck: boolean;
}

export interface SyncQueueItem {
  exposureEventId: number;
}

export interface UnavailableEventRecoverySignals {
  status: string;
  configured: boolean;
  supportedRegion: boolean;
  startDate: string;
  endDate: string;
  todayKey: string;
  recoveryWindowDays: number;
  lastCheckedAt: string | null;
  staleMs: number;
  nowMs: number;
}

export function selectSyncMode(signals: SyncSignals): SyncMode {
  if (
    signals.activeGamePriority ||
    signals.needsPublishedTeamHydration ||
    signals.needsActiveEventRefresh
  ) {
    return "full";
  }
  return signals.needsPublicTeamListRecheck ? "teams" : "full";
}

export function selectFairSyncBatch<T extends SyncQueueItem>(
  standardQueue: readonly T[],
  rosterDiscoveryQueue: readonly T[],
  batchSize: number,
): T[] {
  const limit = Math.max(1, Math.floor(batchSize));
  const rosterReserve = rosterDiscoveryQueue.length
    ? Math.max(1, Math.ceil(limit / 3))
    : 0;
  const selectedStandard = standardQueue.slice(
    0,
    Math.max(0, limit - rosterReserve),
  );
  const selectedRoster = rosterDiscoveryQueue.slice(
    0,
    limit - selectedStandard.length,
  );

  if (selectedStandard.length + selectedRoster.length < limit) {
    const remaining = limit - selectedStandard.length - selectedRoster.length;
    selectedStandard.push(
      ...standardQueue.slice(
        selectedStandard.length,
        selectedStandard.length + remaining,
      ),
    );
  }
  if (selectedStandard.length + selectedRoster.length < limit) {
    const remaining = limit - selectedStandard.length - selectedRoster.length;
    selectedRoster.push(
      ...rosterDiscoveryQueue.slice(
        selectedRoster.length,
        selectedRoster.length + remaining,
      ),
    );
  }

  const result: T[] = [];
  const seen = new Set<number>();
  let standardIndex = 0;
  let rosterIndex = 0;
  while (
    result.length < limit &&
    (standardIndex < selectedStandard.length ||
      rosterIndex < selectedRoster.length)
  ) {
    for (let count = 0; count < 2; count += 1) {
      const item = selectedStandard[standardIndex++];
      if (item && !seen.has(item.exposureEventId)) {
        seen.add(item.exposureEventId);
        result.push(item);
      }
    }
    const rosterItem = selectedRoster[rosterIndex++];
    if (rosterItem && !seen.has(rosterItem.exposureEventId)) {
      seen.add(rosterItem.exposureEventId);
      result.push(rosterItem);
    }
  }
  return result;
}

export function refreshStaleMsForEvent(
  event: { startDate: string; endDate: string },
  todayKey: string,
  activeStaleMs: number,
  postEventStaleMs: number,
): number | null {
  if (todayKey >= event.startDate && todayKey <= event.endDate) {
    return activeStaleMs;
  }
  if (todayKey > event.endDate && todayKey <= addDaysKey(event.endDate, 3)) {
    return postEventStaleMs;
  }
  return null;
}

export function shouldRecoverUnavailableEvent(
  signals: UnavailableEventRecoverySignals,
): boolean {
  if (
    signals.status !== "unavailable" ||
    !signals.configured ||
    !signals.supportedRegion
  ) {
    return false;
  }

  if (
    signals.startDate >
      addDaysKey(signals.todayKey, signals.recoveryWindowDays) ||
    signals.endDate < addDaysKey(signals.todayKey, -1)
  ) {
    return false;
  }

  if (!signals.lastCheckedAt) return true;
  const lastCheckedAt = Date.parse(signals.lastCheckedAt);
  return (
    Number.isNaN(lastCheckedAt) ||
    signals.nowMs - lastCheckedAt >= signals.staleMs
  );
}

function addDaysKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
