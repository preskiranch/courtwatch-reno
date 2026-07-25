import { sanitizeBasketballScore } from "./score-utils.js";
import type { Game } from "./types.js";

/**
 * Merges a newly fetched provider snapshot without allowing an incomplete
 * response to erase a score or downgrade a game that was already final.
 *
 * A complete incoming score pair is still authoritative, so official score
 * corrections continue to flow through normally.
 */
export function reconcileGameSnapshot(
  previous: Game | null,
  incoming: Game,
): Game {
  if (!previous) return incoming;

  const previousHomeScore = sanitizeBasketballScore(previous.homeScore);
  const previousAwayScore = sanitizeBasketballScore(previous.awayScore);
  const incomingHomeScore = sanitizeBasketballScore(incoming.homeScore);
  const incomingAwayScore = sanitizeBasketballScore(incoming.awayScore);
  const previousHasCompleteScore =
    previousHomeScore !== null && previousAwayScore !== null;
  const incomingHasCompleteScore =
    incomingHomeScore !== null && incomingAwayScore !== null;
  const preservePreviousScore =
    previousHasCompleteScore &&
    (!incomingHasCompleteScore ||
      (previous.status === "final" && incoming.status !== "final"));

  return {
    ...incoming,
    divisionId: incoming.divisionId ?? previous.divisionId,
    gameNumber: incoming.gameNumber ?? previous.gameNumber,
    gameType: incoming.gameType ?? previous.gameType,
    venueName: incoming.venueName ?? previous.venueName,
    courtName: incoming.courtName ?? previous.courtName,
    homeTeamId: incoming.homeTeamId ?? previous.homeTeamId,
    awayTeamId: incoming.awayTeamId ?? previous.awayTeamId,
    homeTeamNameSnapshot:
      incoming.homeTeamNameSnapshot ?? previous.homeTeamNameSnapshot,
    awayTeamNameSnapshot:
      incoming.awayTeamNameSnapshot ?? previous.awayTeamNameSnapshot,
    homeScore: preservePreviousScore ? previousHomeScore : incomingHomeScore,
    awayScore: preservePreviousScore ? previousAwayScore : incomingAwayScore,
    status:
      previous.status === "final" && incoming.status !== "final"
        ? "final"
        : incoming.status,
    officialUrl: incoming.officialUrl ?? previous.officialUrl,
    streamingUrl: incoming.streamingUrl ?? previous.streamingUrl,
  };
}
