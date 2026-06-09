import type { ChangeEventType, Game, GameChangeEvent, Team } from "./types.js";
import { dedupeKey } from "./change-detection.js";

const PREF_BY_EVENT: Record<ChangeEventType, string> = {
  new_team_discovered: "newTeamDiscovered",
  new_game_added: "newGameAdded",
  game_time_changed: "gameTimeChanged",
  date_changed: "gameTimeChanged",
  court_changed: "courtChanged",
  venue_changed: "venueChanged",
  opponent_assigned: "opponentAssigned",
  home_away_changed: "opponentAssigned",
  score_posted: "scorePosted",
  final_score: "finalScore",
  final_placement: "bracketUpdate",
  bracket_update: "bracketUpdate",
  team_advanced: "bracketUpdate",
  starting_soon: "gameStartReminderMinutes"
};

export function notificationHash(event: GameChangeEvent, userId: string, channel: "web_push" | "expo"): string {
  return dedupeKey([userId, channel, event.dedupeKey]);
}

export function preferenceKeyForEvent(eventType: ChangeEventType): string {
  return PREF_BY_EVENT[eventType];
}

export function formatNotification(event: GameChangeEvent, game: Game | null, team: Team | null): { title: string; body: string } {
  const teamName = team?.name ?? game?.homeTeamNameSnapshot ?? "Court Watch AAU";
  const court = game?.courtName ? ` on ${game.courtName}` : "";
  const opponent = game ? opponentForTeam(game, team?.id ?? null) : null;

  switch (event.eventType) {
    case "new_team_discovered":
      return { title: `New ${teamName} team found`, body: `${teamName} was added to your tracker.` };
    case "new_game_added":
      return { title: `New game posted for ${teamName}`, body: `${game?.scheduledTime ?? "Tip time TBD"}${court}${opponent ? ` vs ${opponent}` : ""}.` };
    case "game_time_changed":
    case "date_changed":
      return { title: `Time change: ${teamName}`, body: `Now ${game?.scheduledTime ?? "TBD"}${court}${opponent ? ` vs ${opponent}` : ""}.` };
    case "court_changed":
      return { title: `Court change: ${teamName}`, body: `${teamName} now plays${court || " on a new court"}.` };
    case "venue_changed":
      return { title: `Venue change: ${teamName}`, body: `${teamName} now plays at ${game?.venueName ?? "a new venue"}.` };
    case "opponent_assigned":
      return { title: `Opponent assigned: ${teamName}`, body: `${teamName} now plays ${opponent ?? "the posted opponent"}.` };
    case "score_posted":
      return { title: `Score posted: ${teamName}`, body: scoreLine(game) };
    case "final_score":
      return { title: `Final: ${teamName}`, body: scoreLine(game) };
    case "final_placement": {
      const value = event.newValue as Record<string, unknown> | null;
      const placedTeamName =
        typeof value?.teamName === "string" ? value.teamName : teamName;
      const division =
        typeof value?.divisionName === "string" ? value.divisionName : "division";
      const placement =
        typeof value?.placementLabel === "string"
          ? value.placementLabel
          : "final placement";
      return {
        title: `Final result: ${placedTeamName}`,
        body: `${placedTeamName} posted ${placement} in ${division}.`,
      };
    }
    case "bracket_update":
    case "team_advanced":
      return { title: `Bracket update for ${teamName}`, body: `${game?.gameType ?? "Bracket game"} posted${court}.` };
    case "starting_soon":
      return { title: `${teamName} starts soon`, body: `${game?.scheduledTime ?? "Tip time TBD"}${court}${opponent ? ` vs ${opponent}` : ""}.` };
    default:
      return { title: "Court Watch AAU update", body: "A watched schedule item changed." };
  }
}

function opponentForTeam(game: Game, teamId: string | null): string | null {
  if (!teamId) return game.awayTeamNameSnapshot ?? game.homeTeamNameSnapshot;
  if (game.homeTeamId === teamId) return game.awayTeamNameSnapshot;
  if (game.awayTeamId === teamId) return game.homeTeamNameSnapshot;
  return game.awayTeamNameSnapshot ?? game.homeTeamNameSnapshot;
}

function scoreLine(game: Game | null): string {
  if (!game || game.homeScore === null || game.awayScore === null) return "Score was posted.";
  return `${game.homeTeamNameSnapshot ?? "Home"} ${game.homeScore}, ${game.awayTeamNameSnapshot ?? "Away"} ${game.awayScore}`;
}
