import { describe, expect, it } from "vitest";
import { notificationClickUrl } from "./notification-click-url.js";

describe("notification click URLs", () => {
  it("links game alerts to the tournament schedule and exact game", () => {
    expect(
      notificationClickUrl({
        webBaseUrl: "https://courtwatchaau.com/admin",
        exposureEventId: 123456,
        gameId: "game-abc-123",
      }),
    ).toBe(
      "https://courtwatchaau.com/?eventId=123456&tab=schedule&gameId=game-abc-123",
    );
  });

  it("links tournament-only alerts to the tournament alerts screen", () => {
    expect(
      notificationClickUrl({
        webBaseUrl: "https://www.courtwatchaau.com/",
        exposureEventId: 654321,
        gameId: null,
      }),
    ).toBe("https://www.courtwatchaau.com/?eventId=654321&tab=alerts");
  });
});
