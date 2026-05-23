import { describe, expect, it } from "vitest";
import { detectGameChanges } from "./change-detection.js";
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
});
