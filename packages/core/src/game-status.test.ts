import { describe, expect, it } from "vitest";
import { deriveEffectiveGameStatus } from "./game-status.js";
import { seedGames } from "./seed-data.js";

describe("game status fallback", () => {
  it("keeps a tipped non-final game live during the live window", () => {
    expect(
      deriveEffectiveGameStatus(
        {
          ...seedGames[0]!,
          startsAt: "2026-05-25T23:30:00.000Z",
          status: "upcoming",
        },
        new Date("2026-05-26T00:58:00.000Z"),
      ),
    ).toBe("playing_now");
  });

  it("does not invent live status before tip or after the live window", () => {
    const game = {
      ...seedGames[0]!,
      startsAt: "2026-05-25T23:30:00.000Z",
      status: "upcoming" as const,
    };

    expect(
      deriveEffectiveGameStatus(game, new Date("2026-05-25T23:29:00.000Z")),
    ).toBe("upcoming");
    expect(
      deriveEffectiveGameStatus(game, new Date("2026-05-26T01:30:01.000Z")),
    ).toBe("upcoming");
  });

  it("expires a stored live status after the live window when no final score is posted", () => {
    const game = {
      ...seedGames[0]!,
      startsAt: "2026-05-25T23:30:00.000Z",
      status: "playing_now" as const,
    };

    expect(
      deriveEffectiveGameStatus(game, new Date("2026-05-26T00:58:00.000Z")),
    ).toBe("playing_now");
    expect(
      deriveEffectiveGameStatus(game, new Date("2026-05-26T01:30:01.000Z")),
    ).toBe("unknown");
  });

  it("never overrides official final status", () => {
    expect(
      deriveEffectiveGameStatus(
        {
          ...seedGames[0]!,
          startsAt: "2026-05-25T23:30:00.000Z",
          status: "final",
        },
        new Date("2026-05-26T00:58:00.000Z"),
      ),
    ).toBe("final");
  });
});
