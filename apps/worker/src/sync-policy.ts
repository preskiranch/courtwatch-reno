export type SyncMode = "full" | "teams";

export interface SyncSignals {
  activeGamePriority: boolean;
  needsPublishedTeamHydration: boolean;
  needsActiveEventRefresh: boolean;
  needsPublicTeamListRecheck: boolean;
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
