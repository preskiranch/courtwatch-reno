import { describe, expect, it } from "vitest";
import {
  refreshStaleMsForEvent,
  selectFairSyncBatch,
  selectSyncMode,
  shouldRecoverUnavailableEvent,
} from "./sync-policy.js";

describe("selectSyncMode", () => {
  it("uses the lightweight path for a team-list recheck", () => {
    expect(
      selectSyncMode({
        activeGamePriority: false,
        needsPublishedTeamHydration: false,
        needsActiveEventRefresh: false,
        needsPublicTeamListRecheck: true,
      }),
    ).toBe("teams");
  });

  it.each([
    "activeGamePriority",
    "needsPublishedTeamHydration",
    "needsActiveEventRefresh",
  ] as const)("keeps %s on the full game-data path", (signal) => {
    expect(
      selectSyncMode({
        activeGamePriority: false,
        needsPublishedTeamHydration: false,
        needsActiveEventRefresh: false,
        needsPublicTeamListRecheck: true,
        [signal]: true,
      }),
    ).toBe("full");
  });
});

describe("selectFairSyncBatch", () => {
  it("reserves one third of a saturated batch for missing-roster checks", () => {
    const standard = Array.from({ length: 30 }, (_, index) => ({
      exposureEventId: index + 1,
      queue: "standard",
    }));
    const roster = Array.from({ length: 12 }, (_, index) => ({
      exposureEventId: index + 101,
      queue: "roster",
    }));

    const selected = selectFairSyncBatch(standard, roster, 24);

    expect(selected).toHaveLength(24);
    expect(selected.filter((item) => item.queue === "roster")).toHaveLength(8);
    expect(selected.slice(0, 3).map((item) => item.queue)).toEqual([
      "standard",
      "standard",
      "roster",
    ]);
  });

  it("returns unused roster capacity to the standard queue", () => {
    const standard = Array.from({ length: 30 }, (_, index) => ({
      exposureEventId: index + 1,
    }));
    const roster = [{ exposureEventId: 101 }];

    const selected = selectFairSyncBatch(standard, roster, 24);

    expect(selected).toHaveLength(24);
    expect(selected).toContainEqual({ exposureEventId: 101 });
  });

  it("fills the batch from roster discovery when no standard work is due", () => {
    const roster = Array.from({ length: 30 }, (_, index) => ({
      exposureEventId: index + 101,
    }));

    expect(selectFairSyncBatch([], roster, 24)).toHaveLength(24);
  });
});

describe("refreshStaleMsForEvent", () => {
  const event = { startDate: "2026-07-10", endDate: "2026-07-12" };

  it("uses the live cadence only on actual tournament dates", () => {
    expect(refreshStaleMsForEvent(event, "2026-07-11", 30_000, 300_000)).toBe(
      30_000,
    );
  });

  it("uses a slower reconciliation cadence after the tournament", () => {
    expect(refreshStaleMsForEvent(event, "2026-07-15", 30_000, 300_000)).toBe(
      300_000,
    );
  });

  it("stops automatic game hydration after the reconciliation window", () => {
    expect(
      refreshStaleMsForEvent(event, "2026-07-16", 30_000, 300_000),
    ).toBeNull();
  });
});

describe("shouldRecoverUnavailableEvent", () => {
  const baseSignals = {
    status: "unavailable",
    configured: true,
    supportedRegion: true,
    startDate: "2026-07-17",
    endDate: "2026-07-19",
    todayKey: "2026-07-18",
    recoveryWindowDays: 14,
    lastCheckedAt: "2026-07-18T18:00:00.000Z",
    staleMs: 15 * 60_000,
    nowMs: Date.parse("2026-07-18T19:00:00.000Z"),
  };

  it("retries a stale configured tournament during its event window", () => {
    expect(shouldRecoverUnavailableEvent(baseSignals)).toBe(true);
  });

  it.each([
    { configured: false },
    { supportedRegion: false },
    { status: "cancelled" },
    { endDate: "2026-07-16" },
    { startDate: "2026-08-10" },
    {
      lastCheckedAt: "2026-07-18T18:55:00.000Z",
    },
  ])("does not retry an ineligible event: %o", (override) => {
    expect(shouldRecoverUnavailableEvent({ ...baseSignals, ...override })).toBe(
      false,
    );
  });
});
