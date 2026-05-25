import { describe, expect, it } from "vitest";
import { buildTeamScoringLeaders } from "./scoring-leaders.js";
import { seedGames, seedTeams } from "./seed-data.js";
import type { Game } from "./types.js";

describe("team scoring leaders", () => {
  it("ranks teams by total scored points across games", () => {
    const leaders = buildTeamScoringLeaders(
      [
        scoredGame("game-1", "team-splash-4th", "Splash City", 34, "team-premier-10u", "Premier 10U Gold", 20),
        scoredGame("game-2", "team-splash-4th", "Splash City", 28, "team-norcal-6", "NorCal Elite Blue", 35)
      ],
      seedTeams
    );

    expect(leaders.map((leader) => [leader.rank, leader.totalPoints, leader.teamId])).toEqual([
      [1, 62, "team-splash-4th"],
      [2, 35, "team-norcal-6"],
      [3, 20, "team-premier-10u"]
    ]);
  });

  it("uses tied ranks for equal total points", () => {
    const leaders = buildTeamScoringLeaders(
      [
        scoredGame("game-1", "team-splash-4th", "Splash City", 42, "team-premier-10u", "Premier 10U Gold", 42),
        scoredGame("game-2", "team-norcal-6", "NorCal Elite Blue", 21, "team-arsenal-boys-8", "Team Arsenal 8th Black", 12)
      ],
      seedTeams
    );

    expect(leaders.map((leader) => [leader.rank, leader.totalPoints, leader.teamId])).toEqual([
      [1, 42, "team-premier-10u"],
      [1, 42, "team-splash-4th"],
      [3, 21, "team-norcal-6"],
      [4, 12, "team-arsenal-boys-8"]
    ]);
  });

  it("ignores unscored games and placeholder bracket names", () => {
    const unscored = { ...seedGames[0]!, homeScore: null, awayScore: null } satisfies Game;
    const placeholder = scoredGame("game-placeholder", null, "W1 (Championship)", 55, "team-splash-4th", "Splash City", 31);

    const leaders = buildTeamScoringLeaders([unscored, placeholder], seedTeams);

    expect(leaders).toHaveLength(1);
    expect(leaders[0]).toMatchObject({ teamId: "team-splash-4th", totalPoints: 31 });
  });
});

function scoredGame(
  id: string,
  homeTeamId: string | null,
  homeTeamNameSnapshot: string,
  homeScore: number,
  awayTeamId: string | null,
  awayTeamNameSnapshot: string,
  awayScore: number
): Game {
  return {
    ...seedGames[0]!,
    id,
    exposureGameId: id,
    homeTeamId,
    awayTeamId,
    homeTeamNameSnapshot,
    awayTeamNameSnapshot,
    homeScore,
    awayScore,
    status: "final"
  };
}
