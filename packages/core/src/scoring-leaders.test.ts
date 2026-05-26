import { describe, expect, it } from "vitest";
import {
  buildTeamScoringLeaders,
  filterTeamScoringLeadersByDivisionIds,
} from "./scoring-leaders.js";
import { seedGames, seedTeams } from "./seed-data.js";
import type { Game } from "./types.js";

describe("team scoring leaders", () => {
  it("ranks teams by total scored points across games", () => {
    const leaders = buildTeamScoringLeaders(
      [
        scoredGame(
          "game-1",
          "team-splash-4th",
          "Splash City",
          34,
          "team-premier-10u",
          "Premier 10U Gold",
          20,
        ),
        scoredGame(
          "game-2",
          "team-splash-4th",
          "Splash City",
          28,
          "team-norcal-6",
          "NorCal Elite Blue",
          35,
        ),
      ],
      seedTeams,
    );

    expect(
      leaders.map((leader) => [leader.rank, leader.totalPoints, leader.teamId]),
    ).toEqual([
      [1, 62, "team-splash-4th"],
      [2, 35, "team-norcal-6"],
      [3, 20, "team-premier-10u"],
    ]);
    expect(
      leaders.find((leader) => leader.teamId === "team-splash-4th"),
    ).toMatchObject({ wins: 1, losses: 1, ties: 0 });
    expect(
      leaders.find((leader) => leader.teamId === "team-splash-4th"),
    ).toMatchObject({
      latestScore: 28,
      latestOpponentScore: 35,
      latestOpponentName: "NorCal Elite Blue",
      latestGameStatus: "final",
    });
    expect(
      leaders.find((leader) => leader.teamId === "team-norcal-6"),
    ).toMatchObject({ wins: 1, losses: 0, ties: 0 });
    expect(
      leaders.find((leader) => leader.teamId === "team-premier-10u"),
    ).toMatchObject({ wins: 0, losses: 1, ties: 0 });
  });

  it("uses tied ranks for equal total points", () => {
    const leaders = buildTeamScoringLeaders(
      [
        scoredGame(
          "game-1",
          "team-splash-4th",
          "Splash City",
          42,
          "team-premier-10u",
          "Premier 10U Gold",
          42,
        ),
        scoredGame(
          "game-2",
          "team-norcal-6",
          "NorCal Elite Blue",
          21,
          "team-arsenal-boys-8",
          "Team Arsenal 8th Black",
          12,
        ),
      ],
      seedTeams,
    );

    expect(
      leaders.map((leader) => [leader.rank, leader.totalPoints, leader.teamId]),
    ).toEqual([
      [1, 42, "team-premier-10u"],
      [1, 42, "team-splash-4th"],
      [3, 21, "team-norcal-6"],
      [4, 12, "team-arsenal-boys-8"],
    ]);
  });

  it("ignores unscored games and placeholder bracket names", () => {
    const unscored = {
      ...seedGames[0]!,
      homeScore: null,
      awayScore: null,
    } satisfies Game;
    const placeholder = scoredGame(
      "game-placeholder",
      null,
      "W1 (Championship)",
      55,
      "team-splash-4th",
      "Splash City",
      31,
    );

    const leaders = buildTeamScoringLeaders([unscored, placeholder], seedTeams);

    expect(leaders).toHaveLength(1);
    expect(leaders[0]).toMatchObject({
      teamId: "team-splash-4th",
      totalPoints: 31,
    });
    expect(leaders[0]).toMatchObject({ wins: 0, losses: 0, ties: 0 });
  });

  it("can include every registered team with zero points when requested", () => {
    const leaders = buildTeamScoringLeaders(
      [
        scoredGame(
          "game-1",
          "team-splash-4th",
          "Splash City",
          34,
          "team-premier-10u",
          "Premier 10U Gold",
          20,
        ),
      ],
      seedTeams,
      { includeUnscoredTeams: true },
    );

    expect(leaders).toHaveLength(seedTeams.length);
    expect(
      leaders.find((leader) => leader.teamId === "team-splash-4th"),
    ).toMatchObject({ totalPoints: 34, gamesScored: 1 });
    expect(
      leaders.find((leader) => leader.teamId === "team-arsenal-girls-7"),
    ).toMatchObject({
      totalPoints: 0,
      gamesScored: 0,
      wins: 0,
      losses: 0,
      ties: 0,
    });
  });

  it("uses team record totals when games are stale or not loaded yet", () => {
    const leaders = buildTeamScoringLeaders(
      [],
      seedTeams.map((team) =>
        team.id === "team-splash-4th"
          ? {
              ...team,
              record: {
                wins: 3,
                losses: 0,
                ties: 0,
                gamesScored: 3,
                totalPoints: 151,
                finalGames: 3,
                gamesSeen: 3,
              },
            }
          : team,
      ),
      { includeUnscoredTeams: true },
    );

    expect(leaders[0]).toMatchObject({
      rank: 1,
      teamId: "team-splash-4th",
      totalPoints: 151,
      gamesScored: 3,
      wins: 3,
      losses: 0,
    });
    expect(leaders[1]?.rank).toBe(2);
  });

  it("normalizes obvious public-feed score artifacts before ranking", () => {
    const leaders = buildTeamScoringLeaders(
      [
        scoredGame(
          "game-score-artifact",
          "team-premier-10u",
          "Premier 10U Gold",
          29,
          "team-splash-4th",
          "Splash City",
          477,
        ),
      ],
      seedTeams,
    );

    expect(
      leaders.find((leader) => leader.teamId === "team-splash-4th"),
    ).toMatchObject({
      totalPoints: 47,
      wins: 1,
      losses: 0,
    });
    expect(leaders[0]).toMatchObject({
      rank: 1,
      teamId: "team-splash-4th",
      totalPoints: 47,
    });
  });

  it("counts records only from final scored games", () => {
    const liveGame = {
      ...scoredGame(
        "game-live",
        "team-splash-4th",
        "Splash City",
        40,
        "team-premier-10u",
        "Premier 10U Gold",
        30,
      ),
      status: "playing_now" as const,
    };
    const leaders = buildTeamScoringLeaders(
      [
        liveGame,
        scoredGame(
          "game-final",
          "team-splash-4th",
          "Splash City",
          34,
          "team-premier-10u",
          "Premier 10U Gold",
          20,
        ),
        scoredGame(
          "game-tie",
          "team-splash-4th",
          "Splash City",
          42,
          "team-norcal-6",
          "NorCal Elite Blue",
          42,
        ),
      ],
      seedTeams,
    );

    expect(
      leaders.find((leader) => leader.teamId === "team-splash-4th"),
    ).toMatchObject({ totalPoints: 116, wins: 1, losses: 0, ties: 1 });
    expect(
      leaders.find((leader) => leader.teamId === "team-splash-4th"),
    ).toMatchObject({ latestScore: 42, latestOpponentScore: 42 });
    expect(
      leaders.find((leader) => leader.teamId === "team-premier-10u"),
    ).toMatchObject({ totalPoints: 50, wins: 0, losses: 1, ties: 0 });
  });

  it("can compare selected divisions and rerank only those teams", () => {
    const leaders = buildTeamScoringLeaders(
      [
        scoredGame(
          "game-1",
          "team-splash-4th",
          "Splash City",
          34,
          "team-premier-10u",
          "Premier 10U Gold",
          20,
        ),
        scoredGame(
          "game-2",
          "team-splash-6th",
          "Splash City",
          28,
          "team-norcal-6",
          "NorCal Elite Blue",
          35,
        ),
      ],
      seedTeams,
      { includeUnscoredTeams: true },
    );

    const compared = filterTeamScoringLeadersByDivisionIds(leaders, [
      "division-boys-4th-green",
      "division-boys-6th-blue",
    ]);

    expect(compared).toHaveLength(4);
    expect(
      compared.map((leader) => [
        leader.rank,
        leader.totalPoints,
        leader.teamId,
        leader.divisionId,
      ]),
    ).toEqual([
      [1, 35, "team-norcal-6", "division-boys-6th-blue"],
      [2, 34, "team-splash-4th", "division-boys-4th-green"],
      [3, 28, "team-splash-6th", "division-boys-6th-blue"],
      [4, 20, "team-premier-10u", "division-boys-4th-green"],
    ]);
  });
});

function scoredGame(
  id: string,
  homeTeamId: string | null,
  homeTeamNameSnapshot: string,
  homeScore: number,
  awayTeamId: string | null,
  awayTeamNameSnapshot: string,
  awayScore: number,
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
    status: "final",
  };
}
