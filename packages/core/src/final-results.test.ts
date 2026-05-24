import { describe, expect, it } from "vitest";
import { buildDivisionResultGroups, deriveDivisionResultsFromGames } from "./final-results.js";
import { seedGames, seedSnapshot } from "./seed-data.js";
import type { CourtWatchSnapshot, Game } from "./types.js";

describe("final division results", () => {
  it("derives 1st/gold, 2nd/silver, and 3rd/bronze from completed official bracket finals", () => {
    const snapshot = snapshotWithFinals();
    const results = deriveDivisionResultsFromGames(snapshot);

    expect(results.map((result) => [result.placement, result.medalLabel, result.teamId])).toEqual([
      [1, "Gold", "team-splash-4th"],
      [2, "Silver", "team-premier-10u"],
      [3, "Bronze", "team-norcal-6"]
    ]);
    expect(results[0]?.source).toBe("bracket_final");
    expect(results[0]?.isOfficial).toBe(false);
  });

  it("does not treat silver bracket champions as overall champions", () => {
    const snapshot = snapshotWithFinals();
    snapshot.games.push(
      finalGame({
        id: "game-silver-bracket",
        gameType: "Silver Championship",
        homeTeamId: "team-premier-10u",
        awayTeamId: "team-norcal-6",
        homeTeamNameSnapshot: "Premier 10U Gold",
        awayTeamNameSnapshot: "NorCal Elite Blue",
        homeScore: 39,
        awayScore: 38
      })
    );

    const groups = buildDivisionResultGroups(snapshot, { scope: "all" });
    expect(groups[0]?.rows.map((result) => [result.placement, result.teamId])).toEqual([
      [1, "team-splash-4th"],
      [2, "team-premier-10u"],
      [3, "team-norcal-6"]
    ]);
  });

  it("does not treat generic gold bracket games as final placements", () => {
    const snapshot = snapshotWithFinals();
    snapshot.games = [
      finalGame({
        id: "game-gold-bracket-semifinal",
        gameType: "Gold (G12)",
        homeTeamId: "team-splash-4th",
        awayTeamId: "team-premier-10u",
        homeTeamNameSnapshot: "Splash City",
        awayTeamNameSnapshot: "Premier 10U Gold",
        homeScore: 42,
        awayScore: 38
      })
    ];

    expect(deriveDivisionResultsFromGames(snapshot)).toEqual([]);
  });

  it("hides previously stored generic gold bracket placements", () => {
    const snapshot = snapshotWithFinals();
    snapshot.games = [];
    snapshot.divisionResults = [
      {
        id: "stored-generic-gold",
        eventId: snapshot.event.id,
        divisionId: "division-boys-4th-green",
        divisionName: "Boys 4th Green",
        gender: "Boys",
        gradeLevel: "4TH",
        level: "Green",
        teamId: "team-splash-4th",
        teamNameSnapshot: "Splash City",
        teamSourceUrl: null,
        placement: 1,
        medalLabel: "Gold",
        bracketLabel: "Gold (G12)",
        source: "bracket_final",
        sourceUrl: null,
        isOfficial: false,
        sourceHash: "stored",
        rawJson: {},
        lastSeenAt: "2026-05-24T00:00:00.000Z"
      }
    ];

    expect(buildDivisionResultGroups(snapshot, { scope: "all" })).toEqual([]);
  });
});

function snapshotWithFinals(): CourtWatchSnapshot {
  const snapshot = structuredClone(seedSnapshot);
  snapshot.games = [
    finalGame({
      id: "game-gold-final",
      gameType: "Gold Championship",
      homeTeamId: "team-splash-4th",
      awayTeamId: "team-premier-10u",
      homeTeamNameSnapshot: "Splash City",
      awayTeamNameSnapshot: "Premier 10U Gold",
      homeScore: 42,
      awayScore: 38
    }),
    finalGame({
      id: "game-bronze-final",
      gameType: "3rd Place",
      homeTeamId: "team-norcal-6",
      awayTeamId: "team-arsenal-boys-8",
      homeTeamNameSnapshot: "NorCal Elite Blue",
      awayTeamNameSnapshot: "Team Arsenal 8th Black",
      homeScore: 35,
      awayScore: 31
    })
  ];
  return snapshot;
}

function finalGame(input: {
  id: string;
  gameType: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamNameSnapshot: string;
  awayTeamNameSnapshot: string;
  homeScore: number;
  awayScore: number;
}): Game {
  return {
    ...seedGames[0]!,
    id: input.id,
    exposureGameId: input.id,
    divisionId: "division-boys-4th-green",
    gameNumber: input.id,
    gameType: input.gameType,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    homeTeamNameSnapshot: input.homeTeamNameSnapshot,
    awayTeamNameSnapshot: input.awayTeamNameSnapshot,
    homeScore: input.homeScore,
    awayScore: input.awayScore,
    status: "final",
    rawJson: {
      BracketUrl: "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/bracket/test"
    }
  };
}
