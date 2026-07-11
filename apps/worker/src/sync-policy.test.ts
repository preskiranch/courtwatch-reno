import { describe, expect, it } from "vitest";
import { selectSyncMode } from "./sync-policy.js";

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
