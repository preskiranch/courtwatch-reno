import { Prisma } from "@courtwatch/db";
import type { PrismaClient } from "@courtwatch/db";
import { RenderHealthCheckService, TournamentSyncService } from "@courtwatch/core";
import cors from "cors";
import { randomUUID } from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { z } from "zod";
import { config, isDatabaseConfigured, isExposureConfigured } from "./config.js";
import { NotificationService } from "./notification-service.js";
import type { CourtWatchStore } from "./store.js";

const PRESENCE_TTL_MS = 45_000;
const activePresence = new Map<string, { lastSeenAt: number; page: string | null }>();

export function createApp(store: CourtWatchStore, prismaClient: PrismaClient | null = null) {
  const app = express();
  const notifications = new NotificationService(prismaClient);
  const syncService = new TournamentSyncService(async () => {
    const result = await store.syncNow();
    await notifications.sendPending();
    return {
      status: result.status,
      teamsCount: result.teamsCount,
      gamesCount: result.gamesCount,
      changesDetected: result.changesDetected
    };
  });

  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: config.WEB_BASE_URL === "*" ? true : [config.WEB_BASE_URL, "http://localhost:3000", "http://localhost:3001"], credentials: true }));
  app.use(express.json({ limit: "256kb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
  app.use((pinoHttp as unknown as () => express.Handler)());

  app.get("/api/health", async (_req, res, next) => {
    try {
      const snapshot = await store.snapshot();
      const lastSyncAt = snapshot.syncRuns[0]?.completedAt ?? snapshot.event.lastSyncedAt;
      res.json(
        new RenderHealthCheckService().check({
          dbConfigured: isDatabaseConfigured(),
          sourceConfigured: isExposureConfigured(),
          lastSyncAt
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/events/current", async (_req, res, next) => {
    try {
      res.json((await store.snapshot()).event);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/dashboard", async (_req, res, next) => {
    try {
      res.json(await store.dashboard());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/presence", async (_req, res) => {
    prunePresence();
    res.json(presencePayload());
  });

  app.post("/api/presence/heartbeat", async (req, res, next) => {
    try {
      const body = z.object({ clientId: z.string().trim().min(8).max(120).optional(), page: z.string().trim().max(80).optional() }).parse(req.body ?? {});
      const clientId = body.clientId ?? randomUUID();
      activePresence.set(clientId, { lastSeenAt: Date.now(), page: body.page ?? null });
      prunePresence();
      res.json(presencePayload(clientId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/programs", async (_req, res, next) => {
    try {
      res.json((await store.dashboard()).programs);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/programs/:programId", async (req, res, next) => {
    try {
      const program = await store.program(req.params.programId);
      if (!program) {
        res.status(404).json({ error: "Program not found" });
        return;
      }
      res.json(program);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/programs/:programId/aliases", async (req, res, next) => {
    try {
      const body = z.object({ alias: z.string().trim().min(2).max(80) }).parse(req.body);
      res.status(201).json(await store.addAlias(req.params.programId, body.alias));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/programs/:programId/aliases/:aliasId", async (req, res, next) => {
    try {
      await store.deleteAlias(req.params.programId, req.params.aliasId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/teams", async (req, res, next) => {
    try {
      res.json(await store.teams(typeof req.query.search === "string" ? req.query.search : undefined));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/teams/:teamId", async (req, res, next) => {
    try {
      const team = await store.team(req.params.teamId);
      if (!team) {
        res.status(404).json({ error: "Team not found" });
        return;
      }
      res.json(team);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/teams/:teamId/follow", async (req, res, next) => {
    try {
      res.status(201).json(await store.followTeam(req.params.teamId));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/teams/:teamId/follow", async (req, res, next) => {
    try {
      await store.unfollowTeam(req.params.teamId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/games", async (req, res, next) => {
    try {
      res.json(
        await store.games({
          programId: stringQuery(req.query.programId),
          status: stringQuery(req.query.status),
          court: stringQuery(req.query.court),
          division: stringQuery(req.query.division),
          scope: stringQuery(req.query.scope)
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/games/:gameId", async (req, res, next) => {
    try {
      const game = await store.game(req.params.gameId);
      if (!game) {
        res.status(404).json({ error: "Game not found" });
        return;
      }
      res.json(game);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/alerts", async (_req, res, next) => {
    try {
      res.json(await store.alerts());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/push/subscribe", async (req, res, next) => {
    try {
      if (!prismaClient) {
        res.json({ ok: true, mode: "mock" });
        return;
      }
      const body = z
        .object({
          subscription: z.record(z.string(), z.unknown()),
          timezone: z.string().default("America/Los_Angeles"),
          displayName: z.string().optional()
        })
        .parse(req.body);
      const endpoint = String(body.subscription.endpoint ?? "");
      const existing = await prismaClient.user.findFirst({
        where: { pushSubscriptionJson: { path: ["endpoint"], equals: endpoint } }
      });
      const user =
        existing ??
        (await prismaClient.user.create({
          data: {
            displayName: body.displayName ?? "CourtWatch User",
            timezone: body.timezone,
            pushSubscriptionJson: body.subscription as Prisma.InputJsonValue
          }
        }));
      if (existing) {
        await prismaClient.user.update({ where: { id: existing.id }, data: { pushSubscriptionJson: body.subscription as Prisma.InputJsonValue, timezone: body.timezone } });
      }
      await prismaClient.notificationPreference.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id }
      });
      res.status(201).json({ ok: true, userId: user.id, vapidPublicKey: config.VAPID_PUBLIC_KEY ?? null });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/push/unsubscribe", async (req, res, next) => {
    try {
      if (!prismaClient) {
        res.status(204).end();
        return;
      }
      const body = z.object({ endpoint: z.string().optional() }).parse(req.body ?? {});
      if (body.endpoint) {
        await prismaClient.user.updateMany({
          where: { pushSubscriptionJson: { path: ["endpoint"], equals: body.endpoint } },
          data: { pushSubscriptionJson: Prisma.JsonNull }
        });
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings/notification-preferences", async (_req, res, next) => {
    try {
      if (!prismaClient) {
        res.json(defaultNotificationPreferences());
        return;
      }
      const user = await prismaClient.user.findFirst({ include: { notificationPreferences: true } });
      res.json(user?.notificationPreferences[0] ?? defaultNotificationPreferences());
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/settings/notification-preferences", async (req, res, next) => {
    try {
      if (!prismaClient) {
        res.json(defaultNotificationPreferences());
        return;
      }
      const schema = z.object({
        userId: z.string().optional(),
        newTeamDiscovered: z.boolean().optional(),
        newGameAdded: z.boolean().optional(),
        gameTimeChanged: z.boolean().optional(),
        courtChanged: z.boolean().optional(),
        venueChanged: z.boolean().optional(),
        opponentAssigned: z.boolean().optional(),
        scorePosted: z.boolean().optional(),
        finalScore: z.boolean().optional(),
        bracketUpdate: z.boolean().optional(),
        gameStartReminderMinutes: z.array(z.number().int()).optional(),
        dailyDigest: z.boolean().optional()
      });
      const body = schema.parse(req.body);
      const user = body.userId ? await prismaClient.user.findUnique({ where: { id: body.userId } }) : await prismaClient.user.findFirst();
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const { userId: _userId, ...data } = body;
      res.json(
        await prismaClient.notificationPreference.upsert({
          where: { userId: user.id },
          update: data,
          create: { userId: user.id, ...data }
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/sync-now", async (req, res, next) => {
    try {
      if (!isAdminAuthorized(req.headers.authorization, req.headers["x-admin-secret"])) {
        res.status(401).json({ error: "Invalid admin secret" });
        return;
      }
      const result = await syncService.syncOnce();
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof z.ZodError ? 400 : 500;
    const message = error instanceof z.ZodError ? error.flatten() : error instanceof Error ? error.message : "Unknown error";
    res.status(status).json({ error: message });
  });

  return app;
}

function prunePresence(now = Date.now()) {
  for (const [clientId, presence] of activePresence.entries()) {
    if (now - presence.lastSeenAt > PRESENCE_TTL_MS) activePresence.delete(clientId);
  }
}

function presencePayload(clientId?: string) {
  const pages = Array.from(activePresence.values()).reduce<Record<string, number>>((counts, presence) => {
    const key = presence.page ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  return {
    activeUsers: activePresence.size,
    pages,
    clientId: clientId ?? null,
    updatedAt: new Date().toISOString()
  };
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isAdminAuthorized(authorization: string | undefined, adminSecretHeader: string | string[] | undefined): boolean {
  const configured = process.env.ADMIN_SECRET ?? config.ADMIN_SECRET;
  if (!configured) return (process.env.NODE_ENV ?? config.NODE_ENV) !== "production";
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  const headerSecret = Array.isArray(adminSecretHeader) ? adminSecretHeader[0] : adminSecretHeader;
  return bearer === configured || headerSecret === configured;
}

function defaultNotificationPreferences() {
  return {
    newTeamDiscovered: true,
    newGameAdded: true,
    gameTimeChanged: true,
    courtChanged: true,
    venueChanged: true,
    opponentAssigned: true,
    scorePosted: true,
    finalScore: true,
    bracketUpdate: true,
    gameStartReminderMinutes: [60, 30, 15],
    dailyDigest: true
  };
}
