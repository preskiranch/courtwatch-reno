import { describe, expect, it } from "vitest";
import { formatNotification, notificationHash } from "./notification.js";
import { seedChangeEvents } from "./seed-data.js";
import type { GameChangeEvent } from "./types.js";

describe("notification deduplication", () => {
  it("uses stable hashes for the same event/user/channel", () => {
    const first = notificationHash(seedChangeEvents[0]!, "user-1", "web_push");
    const second = notificationHash(seedChangeEvents[0]!, "user-1", "web_push");
    expect(first).toBe(second);
  });

  it("separates channels and users", () => {
    expect(notificationHash(seedChangeEvents[0]!, "user-1", "web_push")).not.toBe(notificationHash(seedChangeEvents[0]!, "user-2", "web_push"));
    expect(notificationHash(seedChangeEvents[0]!, "user-1", "web_push")).not.toBe(notificationHash(seedChangeEvents[0]!, "user-1", "expo"));
  });

  it("formats final placement alerts clearly", () => {
    const event: GameChangeEvent = {
      id: "result-alert-1",
      gameId: null,
      affectedTeamId: "team-1",
      affectedProgramWatchlistId: null,
      eventType: "final_placement",
      previousValue: null,
      newValue: {
        teamName: "NBC Bulls",
        divisionName: "13u Division 2",
        placementLabel: "Champion / 1st / Gold",
      },
      createdAt: "2026-06-07T01:00:00.000Z",
      notificationSent: false,
      dedupeKey: "final-placement:event:division:1:team-1",
    };

    expect(formatNotification(event, null, null)).toEqual({
      title: "Final result: NBC Bulls",
      body: "NBC Bulls posted Champion / 1st / Gold in 13u Division 2.",
    });
  });

  it("formats live-now start alerts clearly", () => {
    const event: GameChangeEvent = {
      id: "start-alert-1",
      gameId: "game-1",
      affectedTeamId: "team-1",
      affectedProgramWatchlistId: null,
      eventType: "starting_soon",
      previousValue: null,
      newValue: { reminderMinutes: 0 },
      createdAt: "2026-06-27T15:50:00.000Z",
      notificationSent: false,
      dedupeKey: "game-1:starting-now:team-1",
    };

    expect(
      formatNotification(
        event,
        {
          id: "game-1",
          eventId: "event-1",
          divisionId: "division-1",
          exposureGameId: "game-1",
          gameNumber: null,
          gameType: "Pool A",
          scheduledDate: "2026-06-27",
          scheduledTime: "8:50 AM",
          startsAt: "2026-06-27T15:50:00.000Z",
          timezone: "America/Los_Angeles",
          venueName: "Christian Brothers High School",
          courtName: "Aux #1",
          homeTeamId: "team-1",
          awayTeamId: "team-2",
          homeTeamNameSnapshot: "Splash City 9U",
          awayTeamNameSnapshot: "Yellow Jackets 9U Gold",
          homeScore: null,
          awayScore: null,
          status: "playing_now",
          officialUrl: null,
          streamingUrl: null,
          updatedAt: "2026-06-27T15:50:00.000Z",
          sourceHash: "hash",
        },
        {
          id: "team-1",
          eventId: "event-1",
          divisionId: "division-1",
          exposureTeamId: "team-1",
          name: "Splash City 9U",
          normalizedName: "splash city 9u",
          clubName: null,
          normalizedClubName: null,
          coachName: null,
          sourceUrl: null,
          lastSeenAt: "2026-06-27T15:50:00.000Z",
        },
      ),
    ).toEqual({
      title: "Splash City 9U is live now",
      body: "8:50 AM on Aux #1 vs Yellow Jackets 9U Gold.",
    });
  });
});
