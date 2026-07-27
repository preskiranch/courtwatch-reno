export function apiReadThroughSourceEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  const configured = environment.API_READ_THROUGH_SOURCE?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return environment.NODE_ENV !== "production";
}
