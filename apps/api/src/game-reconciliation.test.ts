import { describe, expect, it } from "vitest";
import { findStaleGameIds } from "./game-reconciliation.js";

describe("findStaleGameIds", () => {
  it("removes obsolete pending rows while retaining current and final games", () => {
    expect(
      findStaleGameIds(
        [
          {
            id: "current-game",
            exposureGameId: "current-upstream-id",
            status: "upcoming",
          },
          {
            id: "obsolete-placeholder",
            exposureGameId: "removed-upstream-id",
            status: "upcoming",
          },
          {
            id: "completed-history",
            exposureGameId: "removed-final-id",
            status: "FINAL",
          },
          {
            id: "local-game-without-upstream-id",
            exposureGameId: null,
            status: "upcoming",
          },
        ],
        new Set(["current-upstream-id"]),
      ),
    ).toEqual(["obsolete-placeholder"]);
  });

  it("does not remove anything when the upstream snapshot is empty", () => {
    expect(
      findStaleGameIds(
        [
          {
            id: "existing-game",
            exposureGameId: "existing-upstream-id",
            status: "upcoming",
          },
        ],
        new Set(),
      ),
    ).toEqual([]);
  });
});
