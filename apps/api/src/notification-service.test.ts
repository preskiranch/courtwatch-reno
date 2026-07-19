import type { PrismaClient } from "@courtwatch/db";
import { describe, expect, it, vi } from "vitest";
import { notificationClickUrl } from "./notification-click-url.js";
import {
  isPermanentPushFailure,
  NotificationService,
  notificationPreferenceAllows,
  notificationRetryDelayMs,
} from "./notification-service.js";

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

  it("links watched-team discoveries to the matching tournament teams screen", () => {
    expect(
      notificationClickUrl({
        webBaseUrl: "https://www.courtwatchaau.com/",
        exposureEventId: 765432,
        gameId: null,
        tab: "teams",
      }),
    ).toBe("https://www.courtwatchaau.com/?eventId=765432&tab=teams");
  });
});

describe("notification preferences", () => {
  const preference = {
    newTeamDiscovered: true,
    newGameAdded: true,
    gameTimeChanged: true,
    courtChanged: true,
    venueChanged: true,
    opponentAssigned: true,
    scorePosted: false,
    finalScore: true,
    bracketUpdate: true,
    gameStartReminderMinutes: [60, 15],
  };

  it("suppresses event categories disabled by the user", () => {
    expect(
      notificationPreferenceAllows(
        { eventType: "score_posted", newValue: { score: "32-20" } },
        preference,
      ),
    ).toBe(false);
    expect(
      notificationPreferenceAllows(
        { eventType: "final_score", newValue: { score: "42-38" } },
        preference,
      ),
    ).toBe(true);
  });

  it("sends only the configured starting-soon reminders", () => {
    expect(
      notificationPreferenceAllows(
        { eventType: "starting_soon", newValue: { reminderMinutes: 60 } },
        preference,
      ),
    ).toBe(true);
    expect(
      notificationPreferenceAllows(
        { eventType: "starting_soon", newValue: { reminderMinutes: 30 } },
        preference,
      ),
    ).toBe(false);
  });
});

describe("durable push delivery", () => {
  it("uses bounded exponential backoff", () => {
    expect(notificationRetryDelayMs(1, 1_000, 10_000)).toBe(1_000);
    expect(notificationRetryDelayMs(2, 1_000, 10_000)).toBe(2_000);
    expect(notificationRetryDelayMs(8, 1_000, 10_000)).toBe(10_000);
  });

  it("recognizes subscriptions that can never be delivered again", () => {
    expect(isPermanentPushFailure({ statusCode: 404 })).toBe(true);
    expect(isPermanentPushFailure({ statusCode: 410 })).toBe(true);
    expect(isPermanentPushFailure({ statusCode: 503 })).toBe(false);
  });

  it("keeps a transient push failure in the retry queue", async () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    const update = vi.fn().mockResolvedValue({});
    const prisma = notificationPrisma({ update });
    const pushSender = vi.fn().mockRejectedValue(new Error("upstream timeout"));
    const service = new NotificationService(prisma, {
      now: () => now,
      pushSender,
      retryBaseMs: 1_000,
      retryMaxMs: 10_000,
      deliveryTimeoutMs: 100,
    });

    const result = await service.sendPending();

    expect(result).toMatchObject({ attempted: 1, sent: 0, retried: 1 });
    expect(update).toHaveBeenCalledWith({
      where: { id: "notification-1" },
      data: expect.objectContaining({
        status: "retry",
        attemptCount: 1,
        nextAttemptAt: new Date("2026-07-18T12:00:01.000Z"),
      }),
    });
  });

  it("dead-letters an expired subscription and clears it", async () => {
    const update = vi.fn().mockResolvedValue({});
    const userUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = notificationPrisma({ update, userUpdateMany });
    const service = new NotificationService(prisma, {
      pushSender: vi.fn().mockRejectedValue({
        statusCode: 410,
        message: "subscription expired",
      }),
      deliveryTimeoutMs: 100,
    });

    const result = await service.sendPending();

    expect(result).toMatchObject({ attempted: 1, deadLettered: 1 });
    expect(update).toHaveBeenCalledWith({
      where: { id: "notification-1" },
      data: expect.objectContaining({
        status: "dead_letter",
        attemptCount: 1,
      }),
    });
    expect(userUpdateMany).toHaveBeenCalledTimes(1);
  });
});

function notificationPrisma(options: {
  update: ReturnType<typeof vi.fn>;
  userUpdateMany?: ReturnType<typeof vi.fn>;
}): PrismaClient {
  const notification = {
    id: "notification-1",
    userId: "user-1",
    gameChangeEventId: "change-1",
    title: "Game update",
    body: "A watched game changed.",
    channel: "web_push",
    clickUrl: "https://courtwatchaau.com/?eventId=1&tab=schedule",
    sentAt: null,
    status: "pending",
    errorMessage: null,
    dedupeKey: "dedupe-1",
    attemptCount: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    deliveredAt: null,
    deadLetteredAt: null,
    leaseExpiresAt: null,
    user: {
      id: "user-1",
      createdAt: new Date("2026-07-18T00:00:00.000Z"),
      clientId: "device-1",
      email: null,
      passwordHash: null,
      sessionVersion: 0,
      emailVerifiedAt: null,
      displayName: null,
      pushSubscriptionJson: {
        endpoint: "https://push.example.test/subscription-1",
        keys: { p256dh: "public-key", auth: "auth-key" },
      },
      expoPushToken: null,
      timezone: "America/Los_Angeles",
    },
  };
  return {
    user: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany:
        options.userUpdateMany ?? vi.fn().mockResolvedValue({ count: 0 }),
    },
    gameChangeEvent: { findMany: vi.fn().mockResolvedValue([]) },
    notificationLog: {
      findMany: vi.fn().mockResolvedValue([notification]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: options.update,
    },
  } as unknown as PrismaClient;
}
