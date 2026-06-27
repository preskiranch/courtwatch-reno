import { describe, expect, it } from "vitest";
import {
  detectGameChanges,
  startingSoonChangeEventsForGame,
  startingSoonReminderMinuteForGame,
} from "./change-detection.js";
import { seedGames } from "./seed-data.js";

describe("game change detection", () => {
  it("detects meaningful time, court, opponent, score, and final changes", () => {
    const previous = { ...seedGames[0]!, awayTeamNameSnapshot: "TBD", startsAt: "2026-05-23T21:30:00.000Z", courtName: "Court 10" };
    const next = { ...seedGames[0]!, homeScore: 42, awayScore: 38, status: "final" as const };
    const changes = detectGameChanges(previous, next);
    expect(changes.map((change) => change.eventType)).toEqual(expect.arrayContaining(["game_time_changed", "court_changed", "opponent_assigned", "score_posted", "final_score"]));
  });

  it("ignores sub-two-minute time normalization drift", () => {
    const previous = { ...seedGames[0]!, startsAt: "2026-05-23T21:39:00.000Z" };
    const changes = detectGameChanges(previous, seedGames[0]!);
    expect(changes.find((change) => change.eventType === "game_time_changed")).toBeUndefined();
  });

  it("creates start reminder events at the nearest crossed threshold", () => {
    const game = {
      ...seedGames[0]!,
      id: "game-starting-soon",
      startsAt: "2026-06-27T15:50:00.000Z",
      homeTeamId: "team-home",
      awayTeamId: "team-away",
      status: "upcoming" as const,
    };

    expect(
      startingSoonReminderMinuteForGame(
        game,
        new Date("2026-06-27T15:41:00.000Z"),
      ),
    ).toBe(15);

    const events = startingSoonChangeEventsForGame(
      game,
      new Date("2026-06-27T15:41:00.000Z"),
    );
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.affectedTeamId)).toEqual([
      "team-home",
      "team-away",
    ]);
    expect(events[0]?.eventType).toBe("starting_soon");
    expect(events[0]?.newValue).toMatchObject({ reminderMinutes: 15 });
  });

  it("creates a live-now event when a non-final game enters the live window", () => {
    const game = {
      ...seedGames[0]!,
      id: "game-live-now",
      startsAt: "2026-06-27T15:50:00.000Z",
      homeTeamId: "team-home",
      awayTeamId: "team-away",
      status: "upcoming" as const,
    };

    expect(
      startingSoonReminderMinuteForGame(
        game,
        new Date("2026-06-27T15:51:00.000Z"),
      ),
    ).toBe(0);
    expect(
      startingSoonChangeEventsForGame(
        game,
        new Date("2026-06-27T15:51:00.000Z"),
      )[0]?.dedupeKey,
    ).toBe(
      startingSoonChangeEventsForGame(
        game,
        new Date("2026-06-27T15:52:00.000Z"),
      )[0]?.dedupeKey,
    );
  });
});
