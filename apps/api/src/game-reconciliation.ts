export interface StoredGameIdentity {
  id: string;
  exposureGameId: string | null;
  status: string;
}

/**
 * Finds obsolete non-final rows after a complete upstream schedule fetch.
 * Final games are retained as tournament history even if an organizer later
 * removes them from the public schedule.
 */
export function findStaleGameIds(
  storedGames: StoredGameIdentity[],
  currentExposureGameIds: ReadonlySet<string>,
): string[] {
  if (currentExposureGameIds.size === 0) return [];

  return storedGames
    .filter((game) => {
      if (!game.exposureGameId) return false;
      if (game.status.trim().toLowerCase() === "final") return false;
      return !currentExposureGameIds.has(game.exposureGameId);
    })
    .map((game) => game.id);
}
