import { describe, expect, it } from "vitest";
import { buildDashboard } from "./dashboard.js";
import { seedSnapshot } from "./seed-data.js";
import { SELECTED_TEAMS_PROGRAM_ID } from "./types.js";

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
});
