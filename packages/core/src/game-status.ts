import type { Game, GameStatus } from "./types.js";

export const LIVE_GAME_WINDOW_MINUTES = 95;

export function deriveEffectiveGameStatus(
  game: Pick<Game, "startsAt" | "status">,
  now = new Date(),
): GameStatus {
  if (game.status === "final") return "final";

  const startMs = Date.parse(game.startsAt);
  if (!Number.isFinite(startMs)) return game.status;

  const nowMs = now.getTime();
  const liveUntilMs = startMs + LIVE_GAME_WINDOW_MINUTES * 60_000;
  const inLiveWindow = nowMs >= startMs && nowMs <= liveUntilMs;

  if (game.status === "playing_now") {
    if (inLiveWindow) return "playing_now";
    return nowMs < startMs ? "upcoming" : "unknown";
  }

  if (game.status !== "upcoming" && game.status !== "schedule_changed") {
    return game.status;
  }

  return inLiveWindow ? "playing_now" : game.status;
}

export function withEffectiveGameStatus<T extends Game>(
  game: T,
  now = new Date(),
): T {
  const status = deriveEffectiveGameStatus(game, now);
  return status === game.status ? game : { ...game, status };
}

export function withEffectiveGameStatuses<T extends Game>(
  games: T[],
  now = new Date(),
): T[] {
  return games.map((game) => withEffectiveGameStatus(game, now));
}

export function isCurrentOrFutureGame(game: Game, now = new Date()): boolean {
  if (game.status === "final") return false;
  if (deriveEffectiveGameStatus(game, now) === "playing_now") return true;
  return new Date(game.startsAt).getTime() >= now.getTime();
}
