import { describe, expect, it } from "vitest";
import type { TournamentEvent } from "./types.js";
import {
  eligibleTournamentEvents,
  tournamentTodayKey,
} from "./tournament-eligibility.js";

describe("eligibleTournamentEvents", () => {
  it("keeps public team-list tournaments in the six-month active/upcoming window even before teams post", () => {
    const base = tournamentEvent(1, {});
    const events = eligibleTournamentEvents(
      [
        base,
        tournamentEvent(2, {
          name: "More Than 30 Days",
          startDate: "2026-06-25",
          endDate: "2026-06-26",
        }),
        tournamentEvent(8, {
          name: "More Than 90 Days",
          startDate: "2026-08-25",
          endDate: "2026-08-26",
        }),
        tournamentEvent(9, {
          name: "More Than Six Months",
          startDate: "2026-12-01",
          endDate: "2026-12-02",
        }),
        tournamentEvent(3, {
          name: "No Public Teams",
          hasPublicTeamList: false,
        }),
        tournamentEvent(4, { name: "Zero Teams", registeredTeamCount: 0 }),
        tournamentEvent(5, {
          name: "Completed",
          startDate: "2026-04-20",
          endDate: "2026-04-21",
          status: "completed",
        }),
        tournamentEvent(6, { name: "Cancelled", status: "cancelled" }),
        tournamentEvent(7, { name: "Unavailable", status: "unavailable" }),
        tournamentEvent(11, {
          name: "Recent Completed",
          startDate: "2026-05-22",
          endDate: "2026-05-23",
          status: "completed",
        }),
      ],
      { todayKey: "2026-05-24", now: new Date("2026-05-24T12:00:00.000Z") },
    );

    expect(events.map((event) => event.name)).toEqual([
      "Completed",
      "Recent Completed",
      base.name,
      "Zero Teams",
      "More Than 30 Days",
      "More Than 90 Days",
    ]);
  });

  it("keeps completed tournaments with fresh synced data in the finished dropdown for 90 days", () => {
    const events = eligibleTournamentEvents(
      [
        tournamentEvent(255539, {
          name: "2026 Reno Memorial Day Tournament",
          startDate: "2026-05-23",
          endDate: "2026-05-25",
          status: "completed",
          registeredTeamCount: 702,
          lastSyncedAt: "2026-06-02T12:00:00.000Z",
        }),
      ],
      { todayKey: "2026-06-02", now: new Date("2026-06-02T19:00:00.000Z") },
    );

    expect(events.map((event) => event.name)).toEqual([
      "2026 Reno Memorial Day Tournament",
    ]);
    expect(events[0]?.status).toBe("completed");
  });

  it("dedupes repeated provider events", () => {
    const events = eligibleTournamentEvents(
      [
        tournamentEvent(10, { name: "First Copy" }),
        tournamentEvent(10, { id: "event-copy", name: "Second Copy" }),
      ],
      { todayKey: "2026-05-24", now: new Date("2026-05-24T12:00:00.000Z") },
    );

    expect(events.map((event) => event.name)).toEqual(["First Copy"]);
  });

  it("uses the Pacific tournament day instead of UTC for dropdown eligibility", () => {
    expect(tournamentTodayKey(new Date("2026-05-26T00:30:00.000Z"))).toBe(
      "2026-05-25",
    );
  });
});

function tournamentEvent(
  exposureEventId: number,
  overrides: Partial<TournamentEvent>,
): TournamentEvent {
  return {
    id: `event-${exposureEventId}`,
    exposureEventId,
    externalProvider: "exposure_events",
    externalId: String(exposureEventId),
    slug: `event-${exposureEventId}`,
    sourceUrl: `https://basketball.exposureevents.com/${exposureEventId}/event-${exposureEventId}`,
    name: `Tournament ${exposureEventId}`,
    organizer: "Jam On It",
    sport: "basketball",
    sanctioningTags: ["Jam On It", "Exposure Events"],
    gender: "Boys & Girls",
    ageOrGradeDivisions: [],
    venueName: null,
    city: "Reno",
    state: "NV",
    region: "NV",
    startDate: "2026-05-25",
    endDate: "2026-05-26",
    location: "Reno, NV",
    officialUrl: `https://basketball.exposureevents.com/${exposureEventId}/event-${exposureEventId}`,
    timezone: "America/Los_Angeles",
    registeredTeamCount: 12,
    hasPublicTeamList: true,
    lastCheckedAt: "2026-05-24T12:00:00.000Z",
    lastSyncedAt: "2026-05-24T12:00:00.000Z",
    lastTeamChangeAt: "2026-05-24T12:00:00.000Z",
    status: "upcoming",
    ...overrides,
  };
}
