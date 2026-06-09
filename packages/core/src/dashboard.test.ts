import { describe, expect, it } from "vitest";
import { buildDashboard } from "./dashboard.js";
import { seedSnapshot } from "./seed-data.js";
import { SELECTED_TEAMS_PROGRAM_ID } from "./types.js";
import type { CourtWatchSnapshot } from "./types.js";

describe("dashboard response", () => {
  it("returns watched program summaries and a next game", () => {
    const dashboard = buildDashboard(seedSnapshot, new Date("2026-05-23T20:00:00.000Z"));
    expect(dashboard.event.exposureEventId).toBe(255539);
    expect(dashboard.programs.map((program) => program.program.programName)).toEqual(["My Teams"]);
    expect(dashboard.programs[0]?.teams).toHaveLength(0);
    expect(dashboard.nextGame).toBeNull();
    expect(dashboard.programs[0]?.zeroStateMessage).toContain("no teams selected");
  });

  it("keeps tipped watched games in the next-game position as LIVE", () => {
    const dashboard = buildDashboard(
      {
        ...seedSnapshot,
        matches: [
          {
            id: "match-live-game",
            programWatchlistId: SELECTED_TEAMS_PROGRAM_ID,
            teamId: "team-splash-4th",
            matchType: "manual",
            matchConfidence: 1,
            active: true,
            createdAt: "2026-05-25T20:00:00.000Z",
          },
        ],
        games: [
          {
            ...seedSnapshot.games[0]!,
            startsAt: "2026-05-25T23:30:00.000Z",
            scheduledDate: "2026-05-25",
            scheduledTime: "4:30 PM",
            status: "upcoming",
          },
        ],
      },
      new Date("2026-05-26T00:58:00.000Z"),
    );

    expect(dashboard.nextGame?.status).toBe("playing_now");
    expect(dashboard.programs[0]?.teams[0]?.nextGame?.status).toBe(
      "playing_now",
    );
  });

  it("surfaces final placement alerts for followed teams", () => {
    const snapshot = structuredClone(seedSnapshot) as CourtWatchSnapshot;
    snapshot.matches = [
      {
        id: "match-final-placement",
        programWatchlistId: SELECTED_TEAMS_PROGRAM_ID,
        teamId: "team-splash-4th",
        matchType: "manual",
        matchConfidence: 1,
        active: true,
        createdAt: "2026-05-23T00:00:00.000Z",
      },
    ];
    snapshot.changeEvents = [];
    snapshot.divisionResults = [
      {
        id: "result-splash-gold",
        eventId: snapshot.event.id,
        divisionId: "division-boys-4th-green",
        divisionName: "Boys 4th Level 2 Green",
        gender: "Boys",
        gradeLevel: "4TH",
        level: "Level 2",
        teamId: "team-splash-4th",
        teamNameSnapshot: "Splash City",
        teamSourceUrl: null,
        placement: 1,
        medalLabel: "Gold",
        bracketLabel: "Championship",
        source: "bracket_final",
        sourceUrl: "https://basketball.exposureevents.com/bracket/test",
        isOfficial: true,
        sourceHash: "result-splash-gold",
        rawJson: {},
        lastSeenAt: "2026-05-25T23:30:00.000Z",
      },
    ];

    const dashboard = buildDashboard(
      snapshot,
      new Date("2026-05-26T02:00:00.000Z"),
    );

    const placementAlert = dashboard.alerts.find(
      (alert) => alert.eventType === "final_placement",
    );
    expect(placementAlert).toMatchObject({
      eventType: "final_placement",
      affectedTeamId: "team-splash-4th",
      newValue: expect.objectContaining({
        teamName: "Splash City",
        placementLabel: "Champion / 1st / Gold",
      }),
    });
    expect(dashboard.programs[0]?.alertsCount).toBe(1);
  });
});
