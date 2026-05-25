import { describe, expect, it } from "vitest";
import { buildTeamRecordSummaryMap } from "./records.js";
import { ScheduleService } from "./services.js";
import { seedGames, seedSnapshot, seedTeams } from "./seed-data.js";

describe("game record enrichment", () => {
  it("attaches current team records directly to scheduled game rows", () => {
    const service = new ScheduleService();
    const games = service.listWatchedGames(
      {
        ...seedSnapshot,
        games: [
          {
            ...seedGames[0]!,
            id: "game-final-record",
            status: "final",
            homeTeamId: "team-splash-4th",
            awayTeamId: "team-premier-10u",
            homeScore: 34,
            awayScore: 20,
          },
        ],
        teams: seedTeams,
      },
      { scope: "all" },
    );

    expect(games[0]?.homeTeamRecord).toMatchObject({
      wins: 1,
      losses: 0,
      gamesSeen: 1,
    });
    expect(games[0]?.awayTeamRecord).toMatchObject({
      wins: 0,
      losses: 1,
      gamesSeen: 1,
    });
  });

  it("does not publish a 0-0 record when no games have been scored", () => {
    const records = buildTeamRecordSummaryMap(
      [
        {
          ...seedGames[0]!,
          status: "upcoming",
          homeScore: null,
          awayScore: null,
        },
      ],
      seedTeams,
    );

    expect(records.has("team-splash-4th")).toBe(false);
    expect(records.has("team-premier-10u")).toBe(false);
  });
});
