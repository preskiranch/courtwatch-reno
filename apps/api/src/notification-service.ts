import { Prisma, type PrismaClient } from "@courtwatch/db";
import {
  formatNotification,
  notificationHash,
  preferenceKeyForEvent,
} from "@courtwatch/core";
import type {
  ChangeEventType,
  Game,
  GameChangeEvent,
  NotificationPreference,
  Team,
} from "@courtwatch/core";
import webpush from "web-push";
import { config } from "./config.js";
import { notificationClickUrl } from "./notification-click-url.js";

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_MS = 30_000;
const DEFAULT_RETRY_MAX_MS = 30 * 60_000;
const DEFAULT_DELIVERY_TIMEOUT_MS = 15_000;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_DELIVERY_CONCURRENCY = 8;

type PushSender = (
  subscription: webpush.PushSubscription,
  payload: string,
) => Promise<unknown>;

export interface NotificationDeliveryResult {
  attempted: number;
  sent: number;
  skipped: number;
  queued: number;
  retried: number;
  deadLettered: number;
}

export interface NotificationServiceOptions {
  pushSender?: PushSender;
  now?: () => Date;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  deliveryTimeoutMs?: number;
  leaseMs?: number;
  deliveryConcurrency?: number;
}

export class NotificationService {
  private readonly pushSender: PushSender;
  private readonly now: () => Date;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly deliveryTimeoutMs: number;
  private readonly leaseMs: number;
  private readonly deliveryConcurrency: number;
  private readonly pushConfigured: boolean;
  private activeRun: Promise<NotificationDeliveryResult> | null = null;

  constructor(
    private readonly prisma: PrismaClient | null,
    options: NotificationServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.retryBaseMs = Math.max(
      1,
      options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
    );
    this.retryMaxMs = Math.max(
      this.retryBaseMs,
      options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS,
    );
    this.deliveryTimeoutMs = Math.max(
      100,
      options.deliveryTimeoutMs ?? DEFAULT_DELIVERY_TIMEOUT_MS,
    );
    this.leaseMs = Math.max(
      this.deliveryTimeoutMs * 2,
      options.leaseMs ?? DEFAULT_LEASE_MS,
    );
    this.deliveryConcurrency = Math.max(
      1,
      options.deliveryConcurrency ?? DEFAULT_DELIVERY_CONCURRENCY,
    );
    this.pushConfigured = Boolean(
      options.pushSender ||
      (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY),
    );
    this.pushSender =
      options.pushSender ??
      ((subscription, payload) =>
        webpush.sendNotification(subscription, payload));

    if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(
        config.PUSH_CONTACT_EMAIL,
        config.VAPID_PUBLIC_KEY,
        config.VAPID_PRIVATE_KEY,
      );
    }
  }

  sendPending(): Promise<NotificationDeliveryResult> {
    if (this.activeRun) return this.activeRun;
    this.activeRun = this.runPending().finally(() => {
      this.activeRun = null;
    });
    return this.activeRun;
  }

  private async runPending(): Promise<NotificationDeliveryResult> {
    if (!this.prisma) return emptyDeliveryResult();

    const fanout = await this.fanOutPendingChanges();
    if (!this.pushConfigured) {
      return { ...emptyDeliveryResult(), ...fanout };
    }

    const delivery = await this.deliverDueNotifications();
    return {
      ...delivery,
      queued: fanout.queued,
      skipped: fanout.skipped + delivery.skipped,
    };
  }

  private async fanOutPendingChanges(): Promise<{
    queued: number;
    skipped: number;
  }> {
    if (!this.prisma) return { queued: 0, skipped: 0 };
    const users = await this.prisma.user.findMany({
      where: { pushSubscriptionJson: { not: Prisma.AnyNull } },
      include: {
        watchlists: {
          where: { active: true, normalizedProgramName: "my teams" },
          include: { matches: { where: { active: true } } },
        },
        favoriteTeamWatches: { where: { active: true }, select: { id: true } },
        notificationPreferences: true,
      },
    });
    const changes = await this.prisma.gameChangeEvent.findMany({
      where: { notificationSent: false },
      include: {
        game: {
          include: { event: true, homeTeam: true, awayTeam: true },
        },
        affectedTeam: { include: { event: true } },
        favoriteTeamWatch: { select: { id: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    const contexts = users.map((user) => ({
      user,
      watchedTeamIds: new Set(
        user.watchlists.flatMap((watchlist) =>
          watchlist.matches.map((match) => match.teamId),
        ),
      ),
      watchedProgramIds: new Set(
        user.watchlists.map((watchlist) => watchlist.id),
      ),
      favoriteTeamWatchIds: new Set(
        user.favoriteTeamWatches.map((watch) => watch.id),
      ),
      preference: user.notificationPreferences[0] ?? null,
    }));

    let queued = 0;
    let skipped = 0;

    for (const change of changes) {
      const coreEvent = prismaChangeToCore(change);
      const game = change.game ? prismaGameToCore(change.game) : null;
      const rows: Prisma.NotificationLogCreateManyInput[] = [];

      for (const context of contexts) {
        if (
          !shouldNotifyUser(
            coreEvent,
            game,
            context.watchedTeamIds,
            context.watchedProgramIds,
            context.favoriteTeamWatchIds,
          )
        ) {
          skipped += 1;
          continue;
        }
        if (!notificationPreferenceAllows(coreEvent, context.preference)) {
          skipped += 1;
          continue;
        }

        const team = notificationTeamForUser(change, context.watchedTeamIds);
        const message = formatNotification(coreEvent, game, team);
        const exposureEventId =
          change.game?.event.exposureEventId ??
          change.affectedTeam?.event.exposureEventId ??
          exposureEventIdFromValue(change.newValue);
        const clickUrl = notificationClickUrl({
          webBaseUrl: config.WEB_BASE_URL,
          exposureEventId,
          gameId: change.gameId,
          tab:
            change.eventType === "watched_team_registered"
              ? "teams"
              : undefined,
        });
        rows.push({
          userId: context.user.id,
          gameChangeEventId: change.id,
          title: message.title,
          body: message.body,
          clickUrl,
          channel: "web_push",
          status: "pending",
          dedupeKey: notificationHash(coreEvent, context.user.id, "web_push"),
        });
      }

      // notificationSent means durable fan-out completed, not that every
      // delivery succeeded. Individual retries live in notification_log.
      const operations: Prisma.PrismaPromise<unknown>[] = [];
      if (rows.length > 0) {
        operations.push(
          this.prisma.notificationLog.createMany({
            data: rows,
            skipDuplicates: true,
          }),
        );
      }
      operations.push(
        this.prisma.gameChangeEvent.update({
          where: { id: change.id },
          data: { notificationSent: true },
        }),
      );
      const results = await this.prisma.$transaction(operations);
      const createResult = rows.length > 0 ? results[0] : null;
      if (
        createResult &&
        typeof createResult === "object" &&
        "count" in createResult &&
        typeof createResult.count === "number"
      ) {
        queued += createResult.count;
        skipped += rows.length - createResult.count;
      }
    }

    return { queued, skipped };
  }

  private async deliverDueNotifications(): Promise<NotificationDeliveryResult> {
    if (!this.prisma) return emptyDeliveryResult();
    const now = this.now();
    const dueWhere = dueNotificationWhere(now);
    const pending = await this.prisma.notificationLog.findMany({
      where: { channel: "web_push", ...dueWhere },
      include: { user: true },
      orderBy: [{ nextAttemptAt: "asc" }, { sentAt: "asc" }],
      take: 100,
    });

    const results = await mapWithConcurrency(
      pending,
      this.deliveryConcurrency,
      (notification) => this.deliverOne(notification, now),
    );
    return results.reduce(
      (total, result) => ({
        attempted: total.attempted + result.attempted,
        sent: total.sent + result.sent,
        skipped: total.skipped + result.skipped,
        queued: 0,
        retried: total.retried + result.retried,
        deadLettered: total.deadLettered + result.deadLettered,
      }),
      emptyDeliveryResult(),
    );
  }

  private async deliverOne(
    notification: NotificationWithUser,
    observedNow: Date,
  ): Promise<NotificationDeliveryResult> {
    if (!this.prisma) return emptyDeliveryResult();
    const claimedAt = this.now();
    const claim = await this.prisma.notificationLog.updateMany({
      where: { id: notification.id, ...dueNotificationWhere(observedNow) },
      data: {
        status: "processing",
        lastAttemptAt: claimedAt,
        leaseExpiresAt: new Date(claimedAt.getTime() + this.leaseMs),
      },
    });
    if (claim.count !== 1) {
      return { ...emptyDeliveryResult(), skipped: 1 };
    }

    const attemptCount = notification.attemptCount + 1;
    const subscription = pushSubscription(
      notification.user.pushSubscriptionJson,
    );
    if (!subscription) {
      await this.markDeadLetter(
        notification.id,
        attemptCount,
        "Push subscription is missing or invalid",
      );
      return { ...emptyDeliveryResult(), attempted: 1, deadLettered: 1 };
    }

    try {
      await withTimeout(
        this.pushSender(
          subscription,
          JSON.stringify({
            title: notification.title,
            body: notification.body,
            url: notification.clickUrl ?? config.WEB_BASE_URL,
          }),
        ),
        this.deliveryTimeoutMs,
      );
      const deliveredAt = this.now();
      await this.prisma.notificationLog.update({
        where: { id: notification.id },
        data: {
          status: "sent",
          attemptCount,
          sentAt: deliveredAt,
          deliveredAt,
          nextAttemptAt: null,
          leaseExpiresAt: null,
          errorMessage: null,
        },
      });
      return { ...emptyDeliveryResult(), attempted: 1, sent: 1 };
    } catch (error) {
      const message = sanitizedErrorMessage(error);
      const permanent = isPermanentPushFailure(error);
      if (permanent || attemptCount >= this.maxAttempts) {
        await this.markDeadLetter(notification.id, attemptCount, message);
        if (permanent) {
          await this.prisma.user.updateMany({
            where: {
              id: notification.userId,
              pushSubscriptionJson: {
                path: ["endpoint"],
                equals: subscription.endpoint,
              },
            },
            data: { pushSubscriptionJson: Prisma.JsonNull },
          });
        }
        return { ...emptyDeliveryResult(), attempted: 1, deadLettered: 1 };
      }

      await this.prisma.notificationLog.update({
        where: { id: notification.id },
        data: {
          status: "retry",
          attemptCount,
          nextAttemptAt: new Date(
            this.now().getTime() +
              notificationRetryDelayMs(
                attemptCount,
                this.retryBaseMs,
                this.retryMaxMs,
              ),
          ),
          leaseExpiresAt: null,
          errorMessage: message,
        },
      });
      return { ...emptyDeliveryResult(), attempted: 1, retried: 1 };
    }
  }

  private async markDeadLetter(
    id: string,
    attemptCount: number,
    errorMessage: string,
  ) {
    if (!this.prisma) return;
    await this.prisma.notificationLog.update({
      where: { id },
      data: {
        status: "dead_letter",
        attemptCount,
        deadLetteredAt: this.now(),
        nextAttemptAt: null,
        leaseExpiresAt: null,
        errorMessage,
      },
    });
  }
}

type NotificationWithUser = Prisma.NotificationLogGetPayload<{
  include: { user: true };
}>;

function prismaChangeToCore(change: {
  id: string;
  gameId: string | null;
  affectedTeamId: string | null;
  affectedProgramWatchlistId: string | null;
  favoriteTeamWatchId: string | null;
  eventType: string;
  previousValue: unknown;
  newValue: unknown;
  createdAt: Date;
  notificationSent: boolean;
  dedupeKey: string;
}): GameChangeEvent {
  return {
    id: change.id,
    gameId: change.gameId,
    affectedTeamId: change.affectedTeamId,
    affectedProgramWatchlistId: change.affectedProgramWatchlistId,
    favoriteTeamWatchId: change.favoriteTeamWatchId,
    eventType: change.eventType as ChangeEventType,
    previousValue: change.previousValue,
    newValue: change.newValue,
    createdAt: change.createdAt.toISOString(),
    notificationSent: change.notificationSent,
    dedupeKey: change.dedupeKey,
  };
}

function shouldNotifyUser(
  coreEvent: GameChangeEvent,
  game: Game | null,
  watchedTeamIds: Set<string>,
  watchedProgramIds: Set<string>,
  favoriteTeamWatchIds: Set<string>,
): boolean {
  if (
    coreEvent.favoriteTeamWatchId &&
    favoriteTeamWatchIds.has(coreEvent.favoriteTeamWatchId)
  ) {
    return true;
  }
  if (
    coreEvent.affectedProgramWatchlistId &&
    watchedProgramIds.has(coreEvent.affectedProgramWatchlistId)
  )
    return true;
  if (coreEvent.affectedTeamId && watchedTeamIds.has(coreEvent.affectedTeamId))
    return true;
  if (
    game &&
    (watchedTeamIds.has(game.homeTeamId ?? "") ||
      watchedTeamIds.has(game.awayTeamId ?? ""))
  )
    return true;
  return false;
}

export function notificationPreferenceAllows(
  event: Pick<GameChangeEvent, "eventType" | "newValue">,
  preference: Pick<
    NotificationPreference,
    | "newTeamDiscovered"
    | "newGameAdded"
    | "gameTimeChanged"
    | "courtChanged"
    | "venueChanged"
    | "opponentAssigned"
    | "scorePosted"
    | "finalScore"
    | "bracketUpdate"
    | "gameStartReminderMinutes"
  > | null,
): boolean {
  if (!preference) return true;
  const key = preferenceKeyForEvent(event.eventType);
  if (key === "gameStartReminderMinutes") {
    const reminderMinutes = numericObjectValue(
      event.newValue,
      "reminderMinutes",
    );
    return (
      reminderMinutes !== null &&
      preference.gameStartReminderMinutes.includes(reminderMinutes)
    );
  }
  return Boolean(preference[key as keyof typeof preference]);
}

function notificationTeamForUser(
  change: {
    affectedTeam: PrismaTeamRecord | null;
    game: {
      homeTeamId: string | null;
      awayTeamId: string | null;
      homeTeam: PrismaTeamRecord | null;
      awayTeam: PrismaTeamRecord | null;
    } | null;
  },
  watchedTeamIds: ReadonlySet<string>,
): Team | null {
  if (change.affectedTeam) return prismaTeamToCore(change.affectedTeam);
  if (!change.game) return null;
  if (
    change.game.homeTeamId &&
    watchedTeamIds.has(change.game.homeTeamId) &&
    change.game.homeTeam
  ) {
    return prismaTeamToCore(change.game.homeTeam);
  }
  if (
    change.game.awayTeamId &&
    watchedTeamIds.has(change.game.awayTeamId) &&
    change.game.awayTeam
  ) {
    return prismaTeamToCore(change.game.awayTeam);
  }
  return null;
}

function dueNotificationWhere(now: Date): Prisma.NotificationLogWhereInput {
  return {
    OR: [
      {
        status: { in: ["pending", "retry"] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      { status: "processing", leaseExpiresAt: { lte: now } },
    ],
  };
}

function pushSubscription(value: unknown): webpush.PushSubscription | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.endpoint !== "string" ||
    !candidate.endpoint.startsWith("https://") ||
    !candidate.keys ||
    typeof candidate.keys !== "object" ||
    Array.isArray(candidate.keys)
  ) {
    return null;
  }
  const keys = candidate.keys as Record<string, unknown>;
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
    return null;
  }
  return value as webpush.PushSubscription;
}

export function notificationRetryDelayMs(
  attemptCount: number,
  baseMs = DEFAULT_RETRY_BASE_MS,
  maxMs = DEFAULT_RETRY_MAX_MS,
): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attemptCount - 1));
}

export function isPermanentPushFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 410;
}

function sanitizedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

function numericObjectValue(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
}

function emptyDeliveryResult(): NotificationDeliveryResult {
  return {
    attempted: 0,
    sent: 0,
    skipped: 0,
    queued: 0,
    retried: 0,
    deadLettered: 0,
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await operation(values[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Push delivery timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timeout.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function exposureEventIdFromValue(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>).exposureEventId;
  if (typeof candidate === "number" && Number.isInteger(candidate)) {
    return candidate;
  }
  if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
    return Number(candidate);
  }
  return null;
}

function prismaGameToCore(game: {
  id: string;
  eventId: string;
  divisionId: string | null;
  exposureGameId: string | null;
  gameNumber: string | null;
  gameType: string | null;
  scheduledDate: Date;
  scheduledTime: string;
  startsAt: Date;
  timezone: string;
  venueName: string | null;
  courtName: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamNameSnapshot: string | null;
  awayTeamNameSnapshot: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  officialUrl: string | null;
  streamingUrl: string | null;
  updatedAt: Date;
  sourceHash: string;
  rawJson: unknown;
}): Game {
  return {
    id: game.id,
    eventId: game.eventId,
    divisionId: game.divisionId,
    exposureGameId: game.exposureGameId,
    gameNumber: game.gameNumber,
    gameType: game.gameType,
    scheduledDate: game.scheduledDate.toISOString().slice(0, 10),
    scheduledTime: game.scheduledTime,
    startsAt: game.startsAt.toISOString(),
    timezone: game.timezone,
    venueName: game.venueName,
    courtName: game.courtName,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
    homeTeamNameSnapshot: game.homeTeamNameSnapshot,
    awayTeamNameSnapshot: game.awayTeamNameSnapshot,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    status: game.status as Game["status"],
    officialUrl: game.officialUrl,
    streamingUrl: game.streamingUrl,
    updatedAt: game.updatedAt.toISOString(),
    sourceHash: game.sourceHash,
    rawJson: game.rawJson,
  };
}

type PrismaTeamRecord = {
  id: string;
  eventId: string;
  divisionId: string | null;
  exposureTeamId: string | null;
  name: string;
  normalizedName: string;
  clubName: string | null;
  normalizedClubName: string | null;
  coachName: string | null;
  sourceUrl: string | null;
  rawJson: unknown;
  lastSeenAt: Date;
};

function prismaTeamToCore(team: PrismaTeamRecord): Team {
  return {
    id: team.id,
    eventId: team.eventId,
    divisionId: team.divisionId,
    exposureTeamId: team.exposureTeamId,
    name: team.name,
    normalizedName: team.normalizedName,
    clubName: team.clubName,
    normalizedClubName: team.normalizedClubName,
    coachName: team.coachName,
    sourceUrl: team.sourceUrl,
    rawJson: team.rawJson,
    lastSeenAt: team.lastSeenAt.toISOString(),
  };
}
