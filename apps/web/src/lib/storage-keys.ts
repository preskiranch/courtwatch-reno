export const COURTWATCH_CLIENT_ID_KEY = "courtwatch:presence-client-id";
export const SELECTED_EVENT_STORAGE_KEY = "courtwatch-reno:selected-event-id";
export const DASHBOARD_FOLLOW_MIGRATION_KEY =
  "courtwatch:dashboard-follow-migration";
export const LEGACY_DIVISION_COMPARE_STORAGE_KEY =
  "courtwatch:points-division-compare";

export function dashboardFollowMigrationStorageKey(clientId: string): string {
  return `${DASHBOARD_FOLLOW_MIGRATION_KEY}:${encodeURIComponent(clientId)}`;
}

export function divisionCompareStorageKey(clientId: string): string {
  return `${LEGACY_DIVISION_COMPARE_STORAGE_KEY}:${encodeURIComponent(clientId)}`;
}
