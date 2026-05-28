import { Prisma } from "@courtwatch/db";
import type { PrismaClient } from "@courtwatch/db";
import {
  normalizeProgramName,
  RenderHealthCheckService,
  SELECTED_TEAMS_PROGRAM_ID,
  SELECTED_TEAMS_PROGRAM_NAME,
} from "@courtwatch/core";
import cors from "cors";
import { randomUUID } from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { z } from "zod";
import {
  config,
  isDatabaseConfigured,
  isExposureConfigured,
} from "./config.js";
import { NotificationService } from "./notification-service.js";
import type { CourtWatchStore } from "./store.js";

const PRESENCE_TTL_MS = 45_000;
const activePresence = new Map<
  string,
  { lastSeenAt: number; page: string | null }
>();

export function createApp(
  store: CourtWatchStore,
  prismaClient: PrismaClient | null = null,
) {
  const app = express();
  const notifications = new NotificationService(prismaClient);
  const runSync = async (exposureEventId?: number | null) => {
    const result = await store.syncNow(exposureEventId);
    await notifications.sendPending();
    return result;
  };

  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  const allowedWebOrigins =
    config.WEB_BASE_URL === "*"
      ? true
      : [
          config.WEB_BASE_URL,
          ...allowedOriginsFromEnv(config.WEB_ALLOWED_ORIGINS),
          "http://localhost:3000",
          "http://localhost:3001",
          "http://localhost:3002",
          "http://localhost:3003",
        ];
  app.use(
    cors({
      origin: allowedWebOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "256kb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use((pinoHttp as unknown as () => express.Handler)());

  app.get("/api/health", async (_req, res) => {
    res.json(
      new RenderHealthCheckService().check({
        dbConfigured: isDatabaseConfigured(),
        sourceConfigured: isExposureConfigured(),
        lastSyncAt: null,
      }),
    );
  });

  app.get("/api/events", async (_req, res, next) => {
    try {
      res.json(await store.events());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/events/current", async (req, res, next) => {
    try {
      res.json((await store.snapshot(requestExposureEventId(req))).event);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/dashboard", async (req, res, next) => {
    try {
      res.json(
        await store.dashboard(
          requestClientId(req),
          requestExposureEventId(req),
        ),
      );
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
      const body = z
        .object({
          clientId: z.string().trim().min(8).max(120).optional(),
          page: z.string().trim().max(80).optional(),
        })
        .parse(req.body ?? {});
      const clientId = body.clientId ?? randomUUID();
      activePresence.set(clientId, {
        lastSeenAt: Date.now(),
        page: body.page ?? null,
      });
      prunePresence();
      res.json(presencePayload(clientId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/programs", async (req, res, next) => {
    try {
      res.json(
        (
          await store.dashboard(
            requestClientId(req),
            requestExposureEventId(req),
          )
        ).programs,
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/programs/:programId", async (req, res, next) => {
    try {
      const program = await store.program(
        req.params.programId,
        requestClientId(req),
        requestExposureEventId(req),
      );
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
      const body = z
        .object({ alias: z.string().trim().min(2).max(80) })
        .parse(req.body);
      res
        .status(201)
        .json(await store.addAlias(req.params.programId, body.alias));
    } catch (error) {
      next(error);
    }
  });

  app.delete(
    "/api/programs/:programId/aliases/:aliasId",
    async (req, res, next) => {
      try {
        await store.deleteAlias(req.params.programId, req.params.aliasId);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  app.get("/api/teams", async (req, res, next) => {
    try {
      res.json(
        await store.teams(
          typeof req.query.search === "string" ? req.query.search : undefined,
          requestClientId(req),
          requestExposureEventId(req),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/points-leaders", async (req, res, next) => {
    try {
      res.json(
        await store.scoringLeaders(
          requestClientId(req),
          requestExposureEventId(req),
        ),
      );
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
      if (prismaClient) {
        res
          .status(201)
          .json(
            await followTeamDirect(
              prismaClient,
              req.params.teamId,
              requestClientId(req),
            ),
          );
        return;
      }
      res
        .status(201)
        .json(await store.followTeam(req.params.teamId, requestClientId(req)));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/teams/:teamId/follow", async (req, res, next) => {
    try {
      await store.unfollowTeam(req.params.teamId, requestClientId(req));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/games", async (req, res, next) => {
    try {
      res.json(
        await store.games(
          {
            programId: stringQuery(req.query.programId),
            status: stringQuery(req.query.status),
            court: stringQuery(req.query.court),
            division: stringQuery(req.query.division),
            scope: stringQuery(req.query.scope),
          },
          requestClientId(req),
          requestExposureEventId(req),
        ),
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

  app.get("/api/results", async (req, res, next) => {
    try {
      const scope = stringQuery(req.query.scope) === "all" ? "all" : "watched";
      res.json(
        await store.results(
          requestClientId(req),
          scope,
          requestExposureEventId(req),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/alerts", async (req, res, next) => {
    try {
      res.json(
        await store.alerts(requestClientId(req), requestExposureEventId(req)),
      );
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
          displayName: z.string().optional(),
        })
        .parse(req.body);
      const endpoint = String(body.subscription.endpoint ?? "");
      const clientId = requestClientId(req);
      const existing = await prismaClient.user.findFirst({
        where: {
          pushSubscriptionJson: { path: ["endpoint"], equals: endpoint },
        },
      });
      const user = clientId
        ? await prismaClient.user.upsert({
            where: { clientId },
            update: {
              displayName: body.displayName ?? "Court Watch Device",
              timezone: body.timezone,
              pushSubscriptionJson: body.subscription as Prisma.InputJsonValue,
            },
            create: {
              clientId,
              displayName: body.displayName ?? "Court Watch Device",
              timezone: body.timezone,
              pushSubscriptionJson: body.subscription as Prisma.InputJsonValue,
            },
          })
        : (existing ??
          (await prismaClient.user.create({
            data: {
              displayName: body.displayName ?? "Court Watch User",
              timezone: body.timezone,
              pushSubscriptionJson: body.subscription as Prisma.InputJsonValue,
            },
          })));
      if (clientId && existing && existing.id !== user.id) {
        await prismaClient.user.update({
          where: { id: existing.id },
          data: { pushSubscriptionJson: Prisma.JsonNull },
        });
      } else if (existing) {
        await prismaClient.user.update({
          where: { id: existing.id },
          data: {
            pushSubscriptionJson: body.subscription as Prisma.InputJsonValue,
            timezone: body.timezone,
          },
        });
      }
      await prismaClient.notificationPreference.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
      res
        .status(201)
        .json({
          ok: true,
          userId: user.id,
          vapidPublicKey: config.VAPID_PUBLIC_KEY ?? null,
        });
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
      const body = z
        .object({ endpoint: z.string().optional() })
        .parse(req.body ?? {});
      if (body.endpoint) {
        await prismaClient.user.updateMany({
          where: {
            pushSubscriptionJson: { path: ["endpoint"], equals: body.endpoint },
          },
          data: { pushSubscriptionJson: Prisma.JsonNull },
        });
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings/notification-preferences", async (req, res, next) => {
    try {
      if (!prismaClient) {
        res.json(defaultNotificationPreferences());
        return;
      }
      const user = await settingsUser(prismaClient, requestClientId(req));
      const preference = await prismaClient.notificationPreference.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
      res.json(preference);
    } catch (error) {
      next(error);
    }
  });

  app.patch(
    "/api/settings/notification-preferences",
    async (req, res, next) => {
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
          dailyDigest: z.boolean().optional(),
        });
        const body = schema.parse(req.body);
        const user = body.userId
          ? await prismaClient.user.findUnique({ where: { id: body.userId } })
          : await settingsUser(prismaClient, requestClientId(req));
        if (!user) {
          res.status(404).json({ error: "User not found" });
          return;
        }
        const { userId: _userId, ...data } = body;
        res.json(
          await prismaClient.notificationPreference.upsert({
            where: { userId: user.id },
            update: data,
            create: { userId: user.id, ...data },
          }),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  app.post("/api/admin/sync-now", async (req, res, next) => {
    try {
      if (
        !isAdminAuthorized(
          req.headers.authorization,
          req.headers["x-admin-secret"],
        )
      ) {
        res.status(401).json({ error: "Invalid admin secret" });
        return;
      }
      const result = await runSync(requestExposureEventId(req));
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/discover-tournaments", async (req, res, next) => {
    try {
      if (
        !isAdminAuthorized(
          req.headers.authorization,
          req.headers["x-admin-secret"],
        )
      ) {
        res.status(401).json({ error: "Invalid admin secret" });
        return;
      }
      res.json(await store.discoverTournaments());
    } catch (error) {
      next(error);
    }
  });

  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = error instanceof z.ZodError ? 400 : 500;
      const message =
        error instanceof z.ZodError
          ? error.flatten()
          : error instanceof Error
            ? error.message
            : "Unknown error";
      res.status(status).json({ error: message });
    },
  );

  return app;
}

function allowedOriginsFromEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function prunePresence(now = Date.now()) {
  for (const [clientId, presence] of activePresence.entries()) {
    if (now - presence.lastSeenAt > PRESENCE_TTL_MS)
      activePresence.delete(clientId);
  }
}

function presencePayload(clientId?: string) {
  const pages = Array.from(activePresence.values()).reduce<
    Record<string, number>
  >((counts, presence) => {
    const key = presence.page ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  return {
    activeUsers: activePresence.size,
    pages,
    clientId: clientId ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requestClientId(req: express.Request): string | null {
  const headerValue = req.headers["x-courtwatch-client-id"];
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) return null;
  const clientId = raw.trim();
  if (clientId.length < 8 || clientId.length > 160) return null;
  return clientId;
}

function requestExposureEventId(req: express.Request): number | null {
  const queryValue =
    stringQuery(req.query.eventId) ?? stringQuery(req.query.exposureEventId);
  const body = req.body as
    | { eventId?: unknown; exposureEventId?: unknown }
    | undefined;
  const bodyValue = body?.eventId ?? body?.exposureEventId;
  const raw =
    queryValue ??
    (bodyValue === undefined || bodyValue === null
      ? undefined
      : String(bodyValue));
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function followTeamDirect(
  prismaClient: PrismaClient,
  teamId: string,
  clientId: string | null,
) {
  const team = await prismaClient.team.findUnique({ where: { id: teamId } });
  if (!team) throw new Error("Team not found");

  const normalizedProgramName = normalizeProgramName(
    SELECTED_TEAMS_PROGRAM_NAME,
  );
  const program = clientId
    ? await ensureSelectedProgramForClient(
        prismaClient,
        clientId,
        normalizedProgramName,
      )
    : await prismaClient.programWatchlist.upsert({
        where: { id: SELECTED_TEAMS_PROGRAM_ID },
        update: {
          programName: SELECTED_TEAMS_PROGRAM_NAME,
          active: true,
        },
        create: {
          id: SELECTED_TEAMS_PROGRAM_ID,
          programName: SELECTED_TEAMS_PROGRAM_NAME,
          normalizedProgramName,
          active: true,
        },
      });

  const match = await prismaClient.programTeamMatch.upsert({
    where: {
      programWatchlistId_teamId: { programWatchlistId: program.id, teamId },
    },
    update: { active: true, matchType: "manual", matchConfidence: 1 },
    create: {
      programWatchlistId: program.id,
      teamId,
      matchType: "manual",
      matchConfidence: 1,
    },
  });

  return {
    id: match.id,
    programWatchlistId: match.programWatchlistId,
    teamId: match.teamId,
    matchType: match.matchType,
    matchConfidence: Number(match.matchConfidence),
    active: match.active,
    createdAt: match.createdAt.toISOString(),
  };
}

async function ensureSelectedProgramForClient(
  prismaClient: PrismaClient,
  clientId: string,
  normalizedProgramName: string,
) {
  const user = await prismaClient.user.upsert({
    where: { clientId },
    update: {},
    create: {
      clientId,
      displayName: "Court Watch Device",
      timezone: "America/Los_Angeles",
    },
  });

  return prismaClient.programWatchlist.upsert({
    where: {
      userId_normalizedProgramName: {
        userId: user.id,
        normalizedProgramName,
      },
    },
    update: {
      programName: SELECTED_TEAMS_PROGRAM_NAME,
      active: true,
    },
    create: {
      userId: user.id,
      programName: SELECTED_TEAMS_PROGRAM_NAME,
      normalizedProgramName,
      active: true,
    },
  });
}

async function settingsUser(
  prismaClient: PrismaClient,
  clientId: string | null,
) {
  if (clientId) {
    return prismaClient.user.upsert({
      where: { clientId },
      update: {},
      create: {
        clientId,
        displayName: "Court Watch Device",
        timezone: "America/Los_Angeles",
      },
    });
  }
  return (
    (await prismaClient.user.findFirst()) ??
    (await prismaClient.user.create({
      data: {
        displayName: "Court Watch User",
        timezone: "America/Los_Angeles",
      },
    }))
  );
}

function isAdminAuthorized(
  authorization: string | undefined,
  adminSecretHeader: string | string[] | undefined,
): boolean {
  const configured = process.env.ADMIN_SECRET ?? config.ADMIN_SECRET;
  if (!configured)
    return (process.env.NODE_ENV ?? config.NODE_ENV) !== "production";
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  const headerSecret = Array.isArray(adminSecretHeader)
    ? adminSecretHeader[0]
    : adminSecretHeader;
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
    dailyDigest: true,
  };
}
