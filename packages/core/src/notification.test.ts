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
});
