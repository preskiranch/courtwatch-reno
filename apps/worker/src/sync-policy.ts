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

export interface SyncCycleOutcome {
  targetCount: number;
  successfulCount: number;
  failedCount: number;
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

export function nextWorkerFailureCount(
  currentFailureCount: number,
  outcome: SyncCycleOutcome,
): number {
  if (outcome.targetCount === 0 || outcome.failedCount === 0) return 0;
  const completedCount = outcome.successfulCount + outcome.failedCount;
  const failureRatio = completedCount
    ? outcome.failedCount / completedCount
    : 0;
  if (outcome.successfulCount > 0 && failureRatio < 0.75) return 0;
  return Math.max(0, currentFailureCount) + 1;
}

export function retryDelayMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const safeBase = Math.max(1, baseMs);
  const safeMax = Math.max(safeBase, maxMs);
  const exponential = Math.min(
    safeMax,
    safeBase * 2 ** Math.max(0, Math.floor(attempt) - 1),
  );
  const jitterMultiplier = 0.75 + Math.min(1, Math.max(0, random())) * 0.5;
  return Math.max(1, Math.round(exponential * jitterMultiplier));
}

export function jitterDelayMs(
  delayMs: number,
  ratio: number,
  random: () => number = Math.random,
): number {
  const safeDelay = Math.max(1, delayMs);
  const safeRatio = Math.min(0.5, Math.max(0, ratio));
  const multiplier = 1 - safeRatio + 2 * safeRatio * random();
  return Math.max(1, Math.round(safeDelay * multiplier));
}

function addDaysKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
