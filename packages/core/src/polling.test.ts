import { describe, expect, it } from "vitest";
import { calculatePollDelayMs, isActiveTournamentWindow } from "./polling.js";

describe("sync worker polling", () => {
  it("polls every 60 seconds during active tournament hours", () => {
    expect(isActiveTournamentWindow(new Date("2026-05-23T19:00:00.000Z"))).toBe(true);
    expect(calculatePollDelayMs({ failureCount: 0, activeOverride: true })).toBe(60_000);
  });

  it("uses slower polling and backoff outside active hours", () => {
    expect(calculatePollDelayMs({ failureCount: 0, activeOverride: false })).toBe(12 * 60_000);
    expect(calculatePollDelayMs({ failureCount: 2, activeOverride: true })).toBe(240_000);
  });
});
