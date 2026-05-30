import { describe, expect, it } from "vitest";
import {
  calculatePollDelayMs,
  isActiveTournamentWindow,
  isAnyActiveTournamentWindow,
  isActiveTournamentWindowForEvent,
} from "./polling.js";

describe("sync worker polling", () => {
  it("polls every 60 seconds during active tournament hours", () => {
    expect(isActiveTournamentWindow(new Date("2026-05-23T19:00:00.000Z"))).toBe(
      true,
    );
    expect(
      calculatePollDelayMs({ failureCount: 0, activeOverride: true }),
    ).toBe(60_000);
  });

  it("detects active windows for any tournament date instead of only Reno", () => {
    const oakland = {
      startDate: "2026-06-13",
      endDate: "2026-06-14",
      timezone: "America/Los_Angeles",
      status: "active" as const,
    };

    expect(
      isActiveTournamentWindowForEvent(
        oakland,
        new Date("2026-06-13T17:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isAnyActiveTournamentWindow(
        [oakland],
        new Date("2026-06-13T17:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("uses slower polling and backoff outside active hours", () => {
    expect(
      calculatePollDelayMs({ failureCount: 0, activeOverride: false }),
    ).toBe(12 * 60_000);
    expect(
      calculatePollDelayMs({ failureCount: 2, activeOverride: true }),
    ).toBe(240_000);
  });
});
