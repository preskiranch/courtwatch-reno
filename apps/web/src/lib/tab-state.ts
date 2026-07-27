export type PublicAppTab = "dashboard" | "schedule" | "teams" | "alerts";

const publicTabs = new Set<PublicAppTab>([
  "dashboard",
  "schedule",
  "teams",
  "alerts",
]);

export function publicAppTab(value: string | null): PublicAppTab | null {
  return value && publicTabs.has(value as PublicAppTab)
    ? (value as PublicAppTab)
    : null;
}

export function initialPublicAppTab(
  deepLinkValue: string | null,
  storedValue: string | null,
): PublicAppTab {
  return (
    publicAppTab(deepLinkValue) ??
    publicAppTab(storedValue) ??
    "dashboard"
  );
}
