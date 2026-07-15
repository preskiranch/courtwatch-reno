import type { PrismaClient } from "@courtwatch/db";
import { formatNotification, notificationHash } from "@courtwatch/core";
import type { Game, GameChangeEvent, Team } from "@courtwatch/core";
import webpush from "web-push";
import { config } from "./config.js";
import { notificationClickUrl } from "./notification-click-url.js";

export class NotificationService {
  constructor(private readonly prisma: PrismaClient | null) {
    if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(
        config.PUSH_CONTACT_EMAIL,
        config.VAPID_PUBLIC_KEY,
        config.VAPID_PRIVATE_KEY,
      );
    }
  }

  async sendPending(): Promise<{
    attempted: number;
    sent: number;
    skipped: number;
  }> {
    if (!this.prisma || !config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) {
      return { attempted: 0, sent: 0, skipped: 0 };
    }

    const users = await this.prisma.user.findMany({
      where: { pushSubscriptionJson: { not: undefined } },
      include: {
        watchlists: {
          where: { active: true, normalizedProgramName: "my teams" },
          include: { matches: { where: { active: true } } },
        },
        favoriteTeamWatches: { where: { active: true }, select: { id: true } },
      },
    });
    const changes = await this.prisma.gameChangeEvent.findMany({
      where: { notificationSent: false },
      include: {
        game: { include: { event: true } },
        affectedTeam: { include: { event: true } },
        favoriteTeamWatch: { select: { id: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    let attempted = 0;
    let sent = 0;
    let skipped = 0;

    for (const change of changes) {
      for (const user of users) {
        attempted += 1;
        const coreEvent = {
          id: change.id,
          gameId: change.gameId,
          affectedTeamId: change.affectedTeamId,
          affectedProgramWatchlistId: change.affectedProgramWatchlistId,
          favoriteTeamWatchId: change.favoriteTeamWatchId,
          eventType: change.eventType as GameChangeEvent["eventType"],
          previousValue: change.previousValue,
          newValue: change.newValue,
          createdAt: change.createdAt.toISOString(),
          notificationSent: change.notificationSent,
          dedupeKey: change.dedupeKey,
        };
        const game = change.game ? prismaGameToCore(change.game) : null;
        const watchedTeamIds = new Set(
          user.watchlists.flatMap((watchlist) =>
            watchlist.matches.map((match) => match.teamId),
          ),
        );
        const watchedProgramIds = new Set(
          user.watchlists.map((watchlist) => watchlist.id),
        );
        const favoriteTeamWatchIds = new Set(
          user.favoriteTeamWatches.map((watch) => watch.id),
        );
        if (
          !shouldNotifyUser(
            coreEvent,
            game,
            watchedTeamIds,
            watchedProgramIds,
            favoriteTeamWatchIds,
          )
        ) {
          skipped += 1;
          continue;
        }
        const team = change.affectedTeam
          ? prismaTeamToCore(change.affectedTeam)
          : null;
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
        const dedupeKey = notificationHash(coreEvent, user.id, "web_push");
        const existing = await this.prisma.notificationLog.findUnique({
          where: {
            userId_dedupeKey_channel: {
              userId: user.id,
              dedupeKey,
              channel: "web_push",
            },
          },
        });
        if (existing) {
          skipped += 1;
          continue;
        }

        try {
          await webpush.sendNotification(
            user.pushSubscriptionJson as unknown as webpush.PushSubscription,
            JSON.stringify({
              title: message.title,
              body: message.body,
              url: clickUrl,
            }),
          );
          await this.prisma.notificationLog.create({
            data: {
              userId: user.id,
              gameChangeEventId: change.id,
              title: message.title,
              body: message.body,
              channel: "web_push",
              status: "sent",
              dedupeKey,
            },
          });
          sent += 1;
        } catch (error) {
          await this.prisma.notificationLog.create({
            data: {
              userId: user.id,
              gameChangeEventId: change.id,
              title: message.title,
              body: message.body,
              channel: "web_push",
              status: "failed",
              errorMessage:
                error instanceof Error ? error.message : "Unknown push error",
              dedupeKey,
            },
          });
        }
      }
      await this.prisma.gameChangeEvent.update({
        where: { id: change.id },
        data: { notificationSent: true },
      });
    }

    return { attempted, sent, skipped };
  }
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

function prismaTeamToCore(team: {
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
}): Team {
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
