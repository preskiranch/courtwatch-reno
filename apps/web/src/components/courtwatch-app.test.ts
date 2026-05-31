import { describe, expect, it } from "vitest";
import type {
  DashboardResponse,
  Game,
  ProgramSummary,
  Team,
} from "@courtwatch/core";
import { dashboardWithRegisteredFollows } from "../lib/followed-team-reconciliation";
import { mergeTeamLists } from "../lib/followed-team-storage";

const event = {
  id: "event-test",
  exposureEventId: 255539,
  externalProvider: "exposure_events",
  externalId: "255539",
  slug: "test-event",
  sourceUrl: "https://example.com/event",
  name: "Test Tournament",
  organizer: "Test",
  sport: "basketball",
  sanctioningTags: [],
  gender: "Boys & Girls",
  ageOrGradeDivisions: [],
  venueName: null,
  city: "Reno",
  state: "Nevada",
  region: "Nevada",
  startDate: "2099-05-23",
  endDate: "2099-05-25",
  location: "Reno, Nevada",
  officialUrl: "https://example.com/event",
  timezone: "America/Los_Angeles",
  registeredTeamCount: 2,
  hasPublicTeamList: true,
  lastCheckedAt: null,
  lastSyncedAt: "2099-05-23T12:00:00.000Z",
  lastTeamChangeAt: null,
  status: "upcoming",
  dropdownGroup: "tracked",
} satisfies DashboardResponse["event"];

function team(id: string, name: string): Team {
  return {
    id,
    eventId: event.id,
    divisionId: "division-test",
    exposureTeamId: id,
    name,
    normalizedName: name.toLowerCase(),
    clubName: null,
    normalizedClubName: null,
    coachName: null,
    sourceUrl: "https://example.com/team",
    divisionName: "Boys 4th Level 2",
    gender: "Boys",
    gradeLevel: "4TH",
    level: "Level 2",
    rawJson: {},
    lastSeenAt: "2099-05-23T12:00:00.000Z",
    isFollowed: true,
  };
}

function game(homeTeamId: string, awayTeamId: string): Game {
  return {
    id: "game-test",
    eventId: event.id,
    divisionId: "division-test",
    exposureGameId: "game-test",
    gameNumber: "1",
    gameType: "Pool",
    scheduledDate: "2099-05-23",
    scheduledTime: "3:15 PM",
    startsAt: "2099-05-23T22:15:00.000Z",
    timezone: "America/Los_Angeles",
    venueName: "Reno-Sparks Convention Center",
    courtName: "Court CC35",
    homeTeamId,
    awayTeamId,
    homeTeamNameSnapshot: "Splash City 10U",
    awayTeamNameSnapshot: "Opponent",
    homeScore: null,
    awayScore: null,
    status: "upcoming",
    officialUrl: null,
    streamingUrl: null,
    updatedAt: "2099-05-23T12:00:00.000Z",
    sourceHash: "hash",
    rawJson: {},
  };
}

function dashboard(program: ProgramSummary): DashboardResponse {
  return {
    event,
    events: [event],
    nextGame: null,
    programs: [program],
    pointsLeaders: [],
    alerts: [],
    lastUpdated: event.lastSyncedAt,
    sourceStatus: {
      source: "public_page",
      status: "success",
      lastSyncAt: event.lastSyncedAt,
      message: "Schedule data is current from the latest successful sync.",
    },
    disclaimer: "Official schedules and rulings come from tournament staff.",
  };
}

function emptyProgram(): ProgramSummary {
  return {
    program: {
      id: "program-selected-device",
      userId: "user-device",
      programName: "My Teams",
      normalizedProgramName: "my teams",
      active: true,
      createdAt: "2099-05-23T12:00:00.000Z",
    },
    aliases: [],
    teams: [],
    nextGame: null,
    latestResult: null,
    alertsCount: 0,
    zeroStateMessage: "My Teams: no teams selected yet.",
  };
}

describe("dashboard followed-team reconciliation", () => {
  it("rebuilds a stale zero-team dashboard from device-scoped followed teams", () => {
    const splash = team("team-splash-10u", "Splash City 10U");
    const opponent = team("team-opponent", "Opponent");
    opponent.isFollowed = false;

    const reconciled = dashboardWithRegisteredFollows(
      dashboard(emptyProgram()),
      [splash, opponent],
      [game(splash.id, opponent.id)],
      new Map(),
    );

    expect(reconciled.programs[0]?.teams.map((item) => item.id)).toEqual([
      splash.id,
    ]);
    expect(reconciled.programs[0]?.zeroStateMessage).toBeUndefined();
    expect(reconciled.nextGame?.id).toBe("game-test");
  });

  it("refreshes existing followed teams from the latest games and records", () => {
    const splash = team("team-splash-10u", "Splash City 10U");
    const opponent = team("team-opponent", "Opponent");
    opponent.isFollowed = false;
    const staleProgram = emptyProgram();
    staleProgram.teams = [
      {
        ...splash,
        record: undefined,
        matchType: "manual",
        matchConfidence: 1,
        nextGame: null,
        lastResult: null,
        liveStatus: "awaiting_bracket",
      },
    ];

    const reconciled = dashboardWithRegisteredFollows(
      dashboard(staleProgram),
      [splash, opponent],
      [game(splash.id, opponent.id)],
      new Map([
        [
          splash.id,
          {
            wins: 2,
            losses: 0,
            ties: 0,
            gamesScored: 2,
            totalPoints: 111,
            finalGames: 2,
            gamesSeen: 3,
          },
        ],
      ]),
    );

    expect(reconciled.programs[0]?.teams[0]?.record?.wins).toBe(2);
    expect(reconciled.programs[0]?.teams[0]?.nextGame?.id).toBe("game-test");
    expect(reconciled.nextGame?.id).toBe("game-test");
  });

  it("does not erase a saved next game when all-games refresh is temporarily empty", () => {
    const splash = team("team-splash-10u", "Splash City 10U");
    const opponent = team("team-opponent", "Opponent");
    opponent.isFollowed = false;
    const staleProgram = emptyProgram();
    staleProgram.teams = [
      {
        ...splash,
        matchType: "manual",
        matchConfidence: 1,
        nextGame: game(splash.id, opponent.id),
        lastResult: null,
        liveStatus: "upcoming",
      },
    ];

    const reconciled = dashboardWithRegisteredFollows(
      dashboard(staleProgram),
      [splash, opponent],
      [],
      new Map(),
    );

    expect(reconciled.programs[0]?.teams[0]?.nextGame?.id).toBe("game-test");
    expect(reconciled.nextGame?.id).toBe("game-test");
  });

  it("keeps a real zero-team dashboard when the device has no followed teams", () => {
    const registered = team("team-splash-10u", "Splash City 10U");
    registered.isFollowed = false;

    const reconciled = dashboardWithRegisteredFollows(
      dashboard(emptyProgram()),
      [registered],
      [],
      new Map(),
    );

    expect(reconciled.programs[0]?.teams).toHaveLength(0);
    expect(reconciled.programs[0]?.zeroStateMessage).toContain(
      "no teams selected",
    );
  });

  it("keeps a local followed flag when a stale team cache says not followed", () => {
    const stale = team("team-splash-9u", "Splash City 9U");
    stale.isFollowed = false;
    const localFollowed = team("team-splash-9u", "Splash City 9U");
    localFollowed.isFollowed = true;

    expect(mergeTeamLists([stale], [localFollowed])[0]?.isFollowed).toBe(true);
  });
});
