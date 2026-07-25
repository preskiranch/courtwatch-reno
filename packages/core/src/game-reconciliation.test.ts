import { describe, expect, it } from "vitest";
import { reconcileGameSnapshot } from "./game-reconciliation.js";
import { seedGames } from "./seed-data.js";

function game(overrides: Partial<(typeof seedGames)[number]> = {}) {
  return {
    ...seedGames[0]!,
    ...overrides,
  };
}

describe("game snapshot reconciliation", () => {
  it("does not erase a stored final score when a later source snapshot is incomplete", () => {
    const previous = game({
      homeScore: 52,
      awayScore: 48,
      status: "final",
      updatedAt: "2026-07-24T20:00:00.000Z",
    });
    const incoming = game({
      homeScore: null,
      awayScore: null,
      status: "upcoming",
      updatedAt: "2026-07-24T20:05:00.000Z",
    });

    expect(reconcileGameSnapshot(previous, incoming)).toMatchObject({
      homeScore: 52,
      awayScore: 48,
      status: "final",
      updatedAt: "2026-07-24T20:05:00.000Z",
    });
  });

  it("accepts the first complete score and final status", () => {
    const previous = game({
      homeScore: null,
      awayScore: null,
      status: "upcoming",
    });
    const incoming = game({
      homeScore: 42,
      awayScore: 38,
      status: "final",
    });

    expect(reconcileGameSnapshot(previous, incoming)).toMatchObject({
      homeScore: 42,
      awayScore: 38,
      status: "final",
    });
  });

  it("accepts an official correction when both replacement scores are present", () => {
    const previous = game({
      homeScore: 42,
      awayScore: 38,
      status: "final",
    });
    const incoming = game({
      homeScore: 43,
      awayScore: 38,
      status: "final",
    });

    expect(reconcileGameSnapshot(previous, incoming)).toMatchObject({
      homeScore: 43,
      awayScore: 38,
      status: "final",
    });
  });

  it("does not replace a final score with a non-final zero placeholder", () => {
    const previous = game({
      homeScore: 42,
      awayScore: 38,
      status: "final",
    });
    const incoming = game({
      homeScore: 0,
      awayScore: 0,
      status: "upcoming",
    });

    expect(reconcileGameSnapshot(previous, incoming)).toMatchObject({
      homeScore: 42,
      awayScore: 38,
      status: "final",
    });
  });

  it("keeps new schedule details while preserving completed results", () => {
    const previous = game({
      homeScore: 42,
      awayScore: 38,
      status: "final",
      courtName: "Court 1",
      venueName: "Main Gym",
    });
    const incoming = game({
      homeScore: null,
      awayScore: null,
      status: "upcoming",
      courtName: "Court 2",
      venueName: "Fieldhouse",
    });

    expect(reconcileGameSnapshot(previous, incoming)).toMatchObject({
      homeScore: 42,
      awayScore: 38,
      status: "final",
      courtName: "Court 2",
      venueName: "Fieldhouse",
    });
  });

  it("does not replace populated identifiers with nulls from a partial snapshot", () => {
    const previous = game({
      divisionId: "division-existing",
      homeTeamId: "team-home",
      awayTeamId: "team-away",
      homeTeamNameSnapshot: "Home Team",
      awayTeamNameSnapshot: "Away Team",
    });
    const incoming = game({
      divisionId: null,
      homeTeamId: null,
      awayTeamId: null,
      homeTeamNameSnapshot: null,
      awayTeamNameSnapshot: null,
    });

    expect(reconcileGameSnapshot(previous, incoming)).toMatchObject({
      divisionId: "division-existing",
      homeTeamId: "team-home",
      awayTeamId: "team-away",
      homeTeamNameSnapshot: "Home Team",
      awayTeamNameSnapshot: "Away Team",
    });
  });
});
