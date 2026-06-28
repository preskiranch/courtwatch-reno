import { describe, expect, it } from "vitest";
import {
  buildDivisionResultGroups,
  deriveDivisionResultsFromGames,
} from "./final-results.js";
import { seedGames, seedSnapshot } from "./seed-data.js";
import type { CourtWatchSnapshot, Game } from "./types.js";

describe("final division results", () => {
  it("derives 1st/gold, 2nd/silver, and 3rd/bronze from final scored placement games", () => {
    const snapshot = snapshotWithFinals();
    const results = deriveDivisionResultsFromGames(snapshot);

    expect(
      results.map((result) => [
        result.placement,
        result.medalLabel,
        result.teamId,
      ]),
    ).toEqual([
      [1, "Gold", "team-splash-4th"],
      [2, "Silver", "team-premier-10u"],
      [3, "Bronze", "team-norcal-6"],
    ]);
    expect(results[0]?.source).toBe("bracket_final");
    expect(results[0]?.isOfficial).toBe(false);
  });

  it("derives championship placements even when the public feed omits the official placement flag", () => {
    const snapshot = snapshotWithFinals();
    snapshot.games = [
      finalGame({
        id: "game-unsignaled-championship",
        gameType: "Championship (G2)",
        homeTeamId: "team-splash-4th",
        awayTeamId: "team-premier-10u",
        homeTeamNameSnapshot: "Splash City",
        awayTeamNameSnapshot: "Premier 10U Gold",
        homeScore: 51,
        awayScore: 38,
        officialPlacement: false,
      }),
    ];

    expect(
      deriveDivisionResultsFromGames(snapshot).map((result) => [
        result.placement,
        result.teamId,
      ]),
    ).toEqual([
      [1, "team-splash-4th"],
      [2, "team-premier-10u"],
    ]);
  });

  it("does not derive placement winners from unresolved bracket placeholders", () => {
    const snapshot = snapshotWithFinals();
    snapshot.games = [
      finalGame({
        id: "game-placeholder-championship",
        gameType: "Championship (G2)",
        homeTeamId: "team-placeholder-w1",
        awayTeamId: "team-premier-10u",
        homeTeamNameSnapshot: "W1",
        awayTeamNameSnapshot: "Premier 10U Gold",
        homeScore: 51,
        awayScore: 38,
      }),
    ];

    expect(deriveDivisionResultsFromGames(snapshot)).toEqual([]);
  });

  it("uses the secondary completed placement final as bronze when the public feed labels it championship", () => {
    const snapshot = snapshotWithFinals();
    snapshot.games = [
      finalGame({
        id: "game-earlier-championship",
        gameType: "Championship (G2)",
        homeTeamId: "team-splash-4th",
        awayTeamId: "team-norcal-6",
        homeTeamNameSnapshot: "Splash City",
        awayTeamNameSnapshot: "NorCal Elite Blue",
        homeScore: 51,
        awayScore: 38,
        startsAt: "2026-05-25T18:00:00.000Z",
      }),
      finalGame({
        id: "game-secondary-placement",
        gameType: "Championship (G4)",
        homeTeamId: "team-norcal-6",
        awayTeamId: "team-arsenal-boys-8",
        homeTeamNameSnapshot: "NorCal Elite Blue",
        awayTeamNameSnapshot: "Team Arsenal 8th Black",
        homeScore: 49,
        awayScore: 13,
        startsAt: "2026-05-25T21:00:00.000Z",
      }),
      finalGame({
        id: "game-gold-championship",
        gameType: "Championship (G3)",
        homeTeamId: "team-splash-4th",
        awayTeamId: "team-premier-10u",
        homeTeamNameSnapshot: "Splash City",
        awayTeamNameSnapshot: "Premier 10U Gold",
        homeScore: 36,
        awayScore: 16,
        startsAt: "2026-05-25T23:30:00.000Z",
      }),
    ];

    expect(
      deriveDivisionResultsFromGames(snapshot).map((result) => [
        result.placement,
        result.medalLabel,
        result.teamId,
      ]),
    ).toEqual([
      [1, "Gold", "team-splash-4th"],
      [2, "Silver", "team-premier-10u"],
      [3, "Bronze", "team-norcal-6"],
    ]);
  });

  it("does not infer champions from non-placement bracket games that only have scores", () => {
    const snapshot = snapshotWithFinals();
    snapshot.games = [
      finalGame({
        id: "game-unsignaled-generic-final",
        gameType: "Gold (G12)",
        homeTeamId: "team-splash-4th",
        awayTeamId: "team-premier-10u",
        homeTeamNameSnapshot: "Splash City",
        awayTeamNameSnapshot: "Premier 10U Gold",
        homeScore: 51,
        awayScore: 38,
        officialPlacement: false,
      }),
    ];

    expect(deriveDivisionResultsFromGames(snapshot)).toEqual([]);
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
        awayScore: 38,
      }),
    );

    const groups = buildDivisionResultGroups(snapshot, { scope: "all" });
    const resultGroup = groups.find(
      (group) => group.divisionId === "division-boys-4th-green",
    );
    expect(
      resultGroup?.rows.map((result) => [result.placement, result.teamId]),
    ).toEqual([
      [1, "team-splash-4th"],
      [2, "team-premier-10u"],
      [3, "team-norcal-6"],
    ]);
    expect(
      resultGroup?.rows.map((result) => [
        result.teamId,
        result.record?.wins,
        result.record?.losses,
      ]),
    ).toEqual([
      ["team-splash-4th", 1, 0],
      ["team-premier-10u", 1, 1],
      ["team-norcal-6", 1, 1],
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
        awayScore: 38,
      }),
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
        lastSeenAt: "2026-05-24T00:00:00.000Z",
      },
    ];

    const groups = buildDivisionResultGroups(snapshot, { scope: "all" });
    expect(
      groups.find((group) => group.divisionId === "division-boys-4th-green")
        ?.rows,
    ).toEqual([]);
  });

  it("hides previously stored bracket final placements without an official placement signal", () => {
    const snapshot = snapshotWithFinals();
    snapshot.games = [];
    snapshot.divisionResults = [
      {
        id: "stored-unsignaled-championship",
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
        bracketLabel: "Championship (G2)",
        source: "bracket_final",
        sourceUrl: null,
        isOfficial: false,
        sourceHash: "stored",
        rawJson: { homeScore: 51, awayScore: 38 },
        lastSeenAt: "2026-05-24T00:00:00.000Z",
      },
    ];

    const groups = buildDivisionResultGroups(snapshot, { scope: "all" });
    expect(
      groups.find((group) => group.divisionId === "division-boys-4th-green")
        ?.rows,
    ).toEqual([]);
  });

  it("hides previously stored official placement rows that still contain bracket placeholders", () => {
    const snapshot = snapshotWithFinals();
    snapshot.games = [];
    snapshot.divisionResults = [
      {
        id: "stored-placeholder-champion",
        eventId: snapshot.event.id,
        divisionId: "division-boys-4th-green",
        divisionName: "Boys 4th Green",
        gender: "Boys",
        gradeLevel: "4TH",
        level: "Green",
        teamId: null,
        teamNameSnapshot: "W3",
        teamSourceUrl: null,
        placement: 1,
        medalLabel: "Gold",
        bracketLabel: "Championship",
        source: "bracket_final",
        sourceUrl: null,
        isOfficial: true,
        sourceHash: "stored-placeholder",
        rawJson: { OfficialPlacement: true },
        lastSeenAt: "2026-05-24T00:00:00.000Z",
      },
    ];

    const groups = buildDivisionResultGroups(snapshot, { scope: "all" });
    expect(
      groups.find((group) => group.divisionId === "division-boys-4th-green")
        ?.rows,
    ).toEqual([]);
  });

  it("includes every tournament division in all-results scope", () => {
    const snapshot = snapshotWithFinals();
    const groups = buildDivisionResultGroups(snapshot, { scope: "all" });
    const placementGroup = groups.find(
      (group) => group.divisionId === "division-boys-4th-green",
    );
    const pendingGroup = groups.find(
      (group) => group.divisionId === "division-boys-3rd-orange",
    );

    expect(groups).toHaveLength(snapshot.divisions.length);
    expect(placementGroup?.rows).toHaveLength(3);
    expect(pendingGroup).toMatchObject({
      divisionName: "Boys 2nd/3rd Level 3 Orange",
      rows: [],
    });
  });

  it("includes official standings pool result groups even when teams stay attached to the parent division", () => {
    const snapshot = snapshotWithFinals();
    snapshot.games = [];
    snapshot.divisionResults = [
      {
        id: "standings-pool-a-1",
        eventId: snapshot.event.id,
        divisionId: "division-boys-4th-green-pool-a",
        divisionName: "Boys 4th Level 2 Green - Pool A",
        gender: "Boys",
        gradeLevel: "4TH",
        level: "Green",
        teamId: "team-splash-4th",
        teamNameSnapshot: "Splash City",
        teamSourceUrl: null,
        placement: 1,
        medalLabel: "Gold",
        bracketLabel: "Pool A standings",
        source: "official_standings",
        sourceUrl: "https://example.test/standings",
        isOfficial: true,
        sourceHash: "standings-pool-a-1",
        rawJson: {
          source: "public_standings",
          PoolKey: "a",
          Wins: 2,
          Losses: 0,
        },
        lastSeenAt: "2026-05-25T00:00:00.000Z",
      },
    ];

    const groups = buildDivisionResultGroups(snapshot, { scope: "all" });

    expect(
      groups.find(
        (group) => group.divisionId === "division-boys-4th-green-pool-a",
      ),
    ).toMatchObject({
      divisionName: "Boys 4th Level 2 Green - Pool A",
      rows: [
        expect.objectContaining({
          teamNameSnapshot: "Splash City",
          record: expect.objectContaining({ wins: 2, losses: 0 }),
        }),
      ],
    });
    expect(
      groups.find((group) => group.divisionId === "division-boys-4th-green"),
    ).toBeUndefined();
  });

  it("includes watched official standings pool groups when the followed team stays attached to the parent division", () => {
    const snapshot = snapshotWithFinals();
    snapshot.games = [];
    snapshot.matches = [
      {
        id: "match-splash-standing-pool",
        programWatchlistId: snapshot.programs[0]!.id,
        teamId: "team-splash-4th",
        matchType: "manual",
        matchConfidence: 1,
        active: true,
        createdAt: "2026-05-23T00:00:00.000Z",
      },
    ];
    snapshot.divisionResults = [
      {
        id: "standings-pool-a-1",
        eventId: snapshot.event.id,
        divisionId: "division-boys-4th-green-pool-a",
        divisionName: "Boys 4th Level 2 Green - Pool A",
        gender: "Boys",
        gradeLevel: "4TH",
        level: "Green",
        teamId: "team-splash-4th",
        teamNameSnapshot: "Splash City",
        teamSourceUrl: null,
        placement: 1,
        medalLabel: "Gold",
        bracketLabel: "Pool A standings",
        source: "official_standings",
        sourceUrl: "https://example.test/standings",
        isOfficial: true,
        sourceHash: "standings-pool-a-1",
        rawJson: {
          source: "public_standings",
          PoolKey: "a",
          Wins: 2,
          Losses: 0,
        },
        lastSeenAt: "2026-05-25T00:00:00.000Z",
      },
    ];

    expect(buildDivisionResultGroups(snapshot)).toEqual([
      expect.objectContaining({
        divisionId: "division-boys-4th-green-pool-a",
        divisionName: "Boys 4th Level 2 Green - Pool A",
        rows: [
          expect.objectContaining({
            teamNameSnapshot: "Splash City",
            record: expect.objectContaining({ wins: 2, losses: 0 }),
          }),
        ],
      }),
    ]);
  });

  it("includes watched divisions even before final placements are posted", () => {
    const snapshot = snapshotWithFinals();
    snapshot.matches = [
      {
        id: "match-pending-division",
        programWatchlistId: snapshot.programs[0]!.id,
        teamId: "team-splash-3rd",
        matchType: "manual",
        matchConfidence: 1,
        active: true,
        createdAt: "2026-05-23T00:00:00.000Z",
      },
    ];

    expect(
      buildDivisionResultGroups(snapshot).map((group) => group.divisionId),
    ).toEqual(["division-boys-3rd-orange"]);
    expect(buildDivisionResultGroups(snapshot)[0]?.rows).toEqual([]);
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
      awayScore: 38,
    }),
    finalGame({
      id: "game-bronze-final",
      gameType: "3rd Place",
      homeTeamId: "team-norcal-6",
      awayTeamId: "team-arsenal-boys-8",
      homeTeamNameSnapshot: "NorCal Elite Blue",
      awayTeamNameSnapshot: "Team Arsenal 8th Black",
      homeScore: 35,
      awayScore: 31,
    }),
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
  startsAt?: string;
  officialPlacement?: boolean;
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
    startsAt: input.startsAt ?? seedGames[0]!.startsAt,
    status: "final",
    rawJson: {
      BracketUrl:
        "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/bracket/test",
      OfficialPlacement: input.officialPlacement ?? true,
    },
  };
}
