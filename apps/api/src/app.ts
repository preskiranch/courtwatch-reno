import { Prisma } from "@courtwatch/db";
import type { PrismaClient } from "@courtwatch/db";
import {
  isActiveTournamentWindowForEvent,
  isCourtWatchSupportedTournamentRegion,
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
  accountClientId,
  createResetToken,
  hashPasswordAsync,
  normalizeEmail,
  publicAccountUser,
  registeredAccountCount,
  resetTokenExpiresAt,
  sendPasswordResetEmail,
  shouldExposeResetToken,
  signAccountToken,
  tokenHash,
  unregisteredFollowerDeviceCount,
  verifyAccountToken,
  verifyPasswordAsync,
} from "./auth.js";
import {
  config,
  isDatabaseConfigured,
  isExposureConfigured,
} from "./config.js";
import { NotificationService } from "./notification-service.js";
import type { CourtWatchStore, SyncNowOptions } from "./store.js";

const PRESENCE_TTL_MS = 45_000;
const SYNC_STATUS_STREAM_INTERVAL_MS = 1_000;
const SYNC_STATUS_STREAM_HEARTBEAT_MS = 15_000;
const SLOW_REQUEST_WARNING_MS = 1_500;
const ACTIVE_SYNC_STALE_MS = 45_000;
const PASSIVE_SYNC_STALE_MS = 10 * 60_000;
const ADMIN_ACCOUNT_EMAIL = "courtwatchaau@gmail.com";
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
  const syncStatusStreams = new SyncStatusStreamBroker(store);
  const runSync = async (
    exposureEventId?: number | null,
    options: SyncNowOptions = {},
  ) => {
    const result = await store.syncNow(exposureEventId, options);
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
          "https://courtwatchaau.com",
          "https://www.courtwatchaau.com",
          "https://app.courtwatchaau.com",
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
  app.use(
    (
      pinoHttp as unknown as (
        options: Record<string, unknown>,
      ) => express.Handler
    )({
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers['x-admin-secret']",
          "req.body.password",
          "req.body.token",
          "req.body.resetToken",
          "req.body.newPassword",
          "req.body.confirmPassword",
          "res.headers['set-cookie']",
        ],
        remove: true,
      },
    }),
  );
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      if (durationMs < SLOW_REQUEST_WARNING_MS && res.statusCode < 500) return;
      const logger = (
        req as express.Request & {
          log?: {
            warn: (payload: unknown, message?: string) => void;
            error: (payload: unknown, message?: string) => void;
          };
        }
      ).log;
      const payload = {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs),
        eventId: requestExposureEventId(req),
      };
      if (res.statusCode >= 500) {
        logger?.error(payload, "api request failed");
      } else {
        logger?.warn(payload, "api request was slow");
      }
    });
    next();
  });

  const accountAuthRateLimit = rateLimit({
    windowMs: 5 * 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many account attempts. Try again shortly." },
  });
  const passwordResetRateLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many password reset attempts. Try again shortly." },
  });
  const adminWriteRateLimit = rateLimit({
    windowMs: 60_000,
    limit: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many admin requests. Try again shortly." },
  });

  app.get("/api/health", async (_req, res) => {
    res.json(
      new RenderHealthCheckService().check({
        dbConfigured: isDatabaseConfigured(),
        sourceConfigured: isExposureConfigured(),
        lastSyncAt: null,
      }),
    );
  });

  app.get("/api/accounts/stats", async (_req, res, next) => {
    try {
      const [registeredUsers, unregisteredFollowerDevices] = await Promise.all([
        registeredAccountCount(prismaClient),
        unregisteredFollowerDeviceCount(prismaClient),
      ]);
      res.json({
        registeredUsers,
        unregisteredFollowerDevices,
        totalFollowerUsers: registeredUsers + unregisteredFollowerDevices,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/users", async (req, res, next) => {
    try {
      const admin = await requireAdminAccount(req, prismaClient);
      if (!admin) {
        res.status(403).json({ error: "Admin account required" });
        return;
      }
      const [total, users] = await Promise.all([
        registeredAccountCount(prismaClient),
        prismaClient!.user.findMany({
          where: { email: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 500,
          select: {
            id: true,
            email: true,
            displayName: true,
            createdAt: true,
          },
        }),
      ]);
      res.json({
        total,
        users: users.map((user) => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          createdAt: user.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/me", async (req, res, next) => {
    try {
      const session = requestAccountSession(req);
      if (!session || !prismaClient) {
        res.status(401).json({ error: "Not signed in" });
        return;
      }
      const user = await prismaClient.user.findUnique({
        where: { id: session.userId },
      });
      if (!user?.email) {
        res.status(401).json({ error: "Not signed in" });
        return;
      }
      res.json({
        user: publicAccountUser(user),
        totalRegisteredUsers: await registeredAccountCount(prismaClient),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/auth/register",
    accountAuthRateLimit,
    async (req, res, next) => {
      try {
        if (!prismaClient) {
          res.status(503).json({ error: "Accounts require a database" });
          return;
        }
        const body = z
          .object({
            email: z.string().trim().email().max(180),
            password: z.string().min(8).max(160),
            displayName: z.string().trim().min(1).max(80).optional(),
            timezone: z.string().trim().max(80).optional(),
          })
          .parse(req.body ?? {});
        const email = normalizeEmail(body.email);
        const existing = await prismaClient.user.findUnique({
          where: { email },
        });
        if (existing) {
          res.status(409).json({ error: "An account already exists" });
          return;
        }
        const user = await prismaClient.user.create({
          data: {
            email,
            passwordHash: await hashPasswordAsync(body.password),
            displayName: body.displayName ?? email.split("@")[0],
            timezone: body.timezone ?? "America/Los_Angeles",
          },
        });
        await prismaClient.notificationPreference.upsert({
          where: { userId: user.id },
          update: {},
          create: { userId: user.id },
        });
        res.status(201).json({
          token: signAccountToken(user),
          user: publicAccountUser(user),
          totalRegisteredUsers: await registeredAccountCount(prismaClient),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post("/api/auth/login", accountAuthRateLimit, async (req, res, next) => {
    try {
      if (!prismaClient) {
        res.status(503).json({ error: "Accounts require a database" });
        return;
      }
      const body = z
        .object({
          email: z.string().trim().email().max(180),
          password: z.string().min(1).max(160),
        })
        .parse(req.body ?? {});
      const user = await prismaClient.user.findUnique({
        where: { email: normalizeEmail(body.email) },
      });
      if (
        !user?.passwordHash ||
        !(await verifyPasswordAsync(body.password, user.passwordHash))
      ) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      res.json({
        token: signAccountToken(user),
        user: publicAccountUser(user),
        totalRegisteredUsers: await registeredAccountCount(prismaClient),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/auth/forgot-password",
    passwordResetRateLimit,
    async (req, res, next) => {
      try {
        if (!prismaClient) {
          res.status(503).json({ error: "Accounts require a database" });
          return;
        }
        const body = z
          .object({ email: z.string().trim().email().max(180) })
          .parse(req.body ?? {});
        const email = normalizeEmail(body.email);
        const user = await prismaClient.user.findUnique({ where: { email } });
        let emailSent = false;
        let resetToken: string | null = null;
        if (user?.email) {
          resetToken = createResetToken();
          await prismaClient.passwordResetToken.create({
            data: {
              userId: user.id,
              tokenHash: tokenHash(resetToken),
              expiresAt: resetTokenExpiresAt(),
            },
          });
          const delivery = await sendPasswordResetEmail({ email, resetToken });
          emailSent = delivery.sent;
          if (!delivery.sent) {
            const logger = (
              req as express.Request & {
                log?: {
                  warn: (payload: unknown, message?: string) => void;
                };
              }
            ).log;
            logger?.warn(
              {
                configured: delivery.configured,
                from: delivery.from,
                status: delivery.status,
                error: delivery.error,
              },
              "Password reset email was not sent",
            );
          }
        }
        res.json({
          ok: true,
          emailSent,
          message:
            "If an account exists, reset instructions have been generated.",
          resetToken: shouldExposeResetToken() ? resetToken : undefined,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/auth/reset-password",
    passwordResetRateLimit,
    async (req, res, next) => {
      try {
        if (!prismaClient) {
          res.status(503).json({ error: "Accounts require a database" });
          return;
        }
        const parsedBody = z
          .object({
            token: z.string().trim().min(16).max(200),
            password: z.string().min(8).max(160),
          })
          .safeParse(req.body ?? {});
        if (!parsedBody.success) {
          res.status(400).json({
            error:
              "Paste the reset code from your email and enter a password with at least 8 characters.",
          });
          return;
        }
        const body = parsedBody.data;
        const resetToken = await prismaClient.passwordResetToken.findUnique({
          where: { tokenHash: tokenHash(body.token) },
        });
        if (
          !resetToken ||
          resetToken.usedAt ||
          resetToken.expiresAt.getTime() < Date.now()
        ) {
          res.status(400).json({ error: "Reset code is invalid or expired" });
          return;
        }
        await prismaClient.$transaction([
          prismaClient.user.update({
            where: { id: resetToken.userId },
            data: { passwordHash: await hashPasswordAsync(body.password) },
          }),
          prismaClient.passwordResetToken.update({
            where: { id: resetToken.id },
            data: { usedAt: new Date() },
          }),
        ]);
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post("/api/account/sync-followed-teams", async (req, res, next) => {
    try {
      const session = requestAccountSession(req);
      if (!session || !prismaClient) {
        res.status(401).json({ error: "Sign in to sync followed teams" });
        return;
      }
      const body = z
        .object({
          teamIds: z.array(z.string().trim().min(1)).max(500),
        })
        .parse(req.body ?? {});
      const identity = accountClientId(session.userId);
      const synced = [];
      for (const teamId of Array.from(new Set(body.teamIds))) {
        synced.push(await followTeamDirect(prismaClient, teamId, identity));
      }
      res.json({ ok: true, syncedCount: synced.length });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/account/sync-favorite-team-watches",
    async (req, res, next) => {
      try {
        const session = requestAccountSession(req);
        if (!session) {
          res.status(401).json({ error: "Sign in to sync team alerts" });
          return;
        }
        const sourceClientId = requestClientId(req);
        if (!sourceClientId) {
          res.status(400).json({ error: "Device identity is required" });
          return;
        }
        const syncedCount = await store.syncFavoriteTeamWatches(
          sourceClientId,
          accountClientId(session.userId),
        );
        res.json({ ok: true, syncedCount });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get("/api/events", async (req, res, next) => {
    try {
      res.json(await store.events(requestClientIdentity(req)));
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

  app.get("/api/sync-status", async (req, res, next) => {
    try {
      res.json(
        await store.syncStatus(
          requestExposureEventId(req),
          stringQuery(req.query.scope) === "all" ? "all" : "event",
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sync-health", async (req, res, next) => {
    try {
      if (!prismaClient) {
        res.status(503).json({ error: "Sync health requires a database" });
        return;
      }
      const requestedEventId = requestExposureEventId(req);
      const limit = numericQuery(req.query.limit, 1, 250) ?? 100;
      const today = dateOnlyInPacific(new Date());
      const where: Prisma.EventWhereInput = requestedEventId
        ? { exposureEventId: requestedEventId }
        : {
            status: { notIn: ["cancelled", "unavailable"] },
            startDate: { lte: dateKeyToUtcDate(addDaysKey(today, 14)) },
            endDate: { gte: dateKeyToUtcDate(addDaysKey(today, -3)) },
          };

      const events = await prismaClient.event.findMany({
        where,
        orderBy: [{ startDate: "asc" }, { name: "asc" }],
        take: requestedEventId ? 1 : limit,
        select: {
          id: true,
          exposureEventId: true,
          externalProvider: true,
          name: true,
          organizer: true,
          city: true,
          state: true,
          location: true,
          region: true,
          startDate: true,
          endDate: true,
          registeredTeamCount: true,
          hasPublicTeamList: true,
          lastCheckedAt: true,
          lastSyncedAt: true,
          lastTeamChangeAt: true,
          status: true,
        },
      });
      const eventIds = events.map((event) => event.id);
      const [teamCounts, gameCounts, latestRuns] = await Promise.all([
        prismaClient.team.groupBy({
          by: ["eventId"],
          where: { eventId: { in: eventIds } },
          _count: { _all: true },
        }),
        prismaClient.game.groupBy({
          by: ["eventId"],
          where: { eventId: { in: eventIds } },
          _count: { _all: true },
        }),
        prismaClient.syncRun.findMany({
          where: { eventId: { in: eventIds } },
          orderBy: { completedAt: "desc" },
          select: {
            eventId: true,
            status: true,
            completedAt: true,
            errorMessage: true,
            teamsCount: true,
            gamesCount: true,
            changesDetected: true,
          },
        }),
      ]);
      const teamsByEventId = countMap(teamCounts);
      const gamesByEventId = countMap(gameCounts);
      const latestRunByEventId = new Map<string, (typeof latestRuns)[number]>();
      for (const run of latestRuns) {
        if (!latestRunByEventId.has(run.eventId))
          latestRunByEventId.set(run.eventId, run);
      }

      const now = new Date();
      const eventHealth = events.map((event) => {
        const activeWindow = isActiveTournamentWindowForEvent(
          {
            startDate: dateOnlyKey(event.startDate),
            endDate: dateOnlyKey(event.endDate),
            timezone: "America/Los_Angeles",
            status: event.status as "active" | "upcoming" | "completed",
          },
          now,
        );
        const lastDataAt = latestDate(
          event.lastSyncedAt,
          event.lastCheckedAt,
          event.lastTeamChangeAt,
          latestRunByEventId.get(event.id)?.completedAt ?? null,
        );
        const staleAfterMs = activeWindow
          ? ACTIVE_SYNC_STALE_MS
          : PASSIVE_SYNC_STALE_MS;
        const ageMs = lastDataAt ? now.getTime() - lastDataAt.getTime() : null;
        return {
          exposureEventId: event.exposureEventId,
          name: event.name,
          organizer: event.organizer,
          location:
            [event.city, event.state].filter(Boolean).join(", ") ||
            event.location,
          region: event.region,
          status: event.status,
          supportedRegion: isCourtWatchSupportedTournamentRegion(event),
          startDate: dateOnlyKey(event.startDate),
          endDate: dateOnlyKey(event.endDate),
          registeredTeamCount: event.registeredTeamCount,
          hasPublicTeamList: event.hasPublicTeamList,
          teamsStored: teamsByEventId.get(event.id) ?? 0,
          gamesStored: gamesByEventId.get(event.id) ?? 0,
          activeWindow,
          lastCheckedAt: event.lastCheckedAt?.toISOString() ?? null,
          lastSyncedAt: event.lastSyncedAt?.toISOString() ?? null,
          lastTeamChangeAt: event.lastTeamChangeAt?.toISOString() ?? null,
          latestSyncRun: latestRunByEventId.get(event.id)
            ? {
                status: latestRunByEventId.get(event.id)!.status,
                completedAt:
                  latestRunByEventId
                    .get(event.id)!
                    .completedAt?.toISOString() ?? null,
                teamsCount: latestRunByEventId.get(event.id)!.teamsCount,
                gamesCount: latestRunByEventId.get(event.id)!.gamesCount,
                changesDetected: latestRunByEventId.get(event.id)!
                  .changesDetected,
                errorMessage: latestRunByEventId.get(event.id)!.errorMessage,
              }
            : null,
          dataAgeSeconds:
            ageMs === null ? null : Math.max(0, Math.round(ageMs / 1000)),
          freshness:
            ageMs === null
              ? "never_synced"
              : ageMs > staleAfterMs
                ? "stale"
                : "fresh",
        };
      });

      res.json({
        generatedAt: now.toISOString(),
        activeStaleAfterSeconds: Math.round(ACTIVE_SYNC_STALE_MS / 1000),
        passiveStaleAfterSeconds: Math.round(PASSIVE_SYNC_STALE_MS / 1000),
        count: eventHealth.length,
        staleCount: eventHealth.filter((event) => event.freshness === "stale")
          .length,
        neverSyncedCount: eventHealth.filter(
          (event) => event.freshness === "never_synced",
        ).length,
        events: eventHealth,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/realtime/sync-status", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write("retry: 2000\n\n");

    const unsubscribe = syncStatusStreams.subscribe(res);
    _req.on("close", unsubscribe);
  });

  app.get("/api/dashboard", async (req, res, next) => {
    try {
      res.json(
        await store.dashboard(
          requestClientIdentity(req),
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
            requestClientIdentity(req),
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
        requestClientIdentity(req),
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
      const limit = numericQuery(req.query.limit, 1, 100);
      res.json(
        await store.teams(
          typeof req.query.search === "string" ? req.query.search : undefined,
          requestClientIdentity(req),
          requestExposureEventId(req),
          stringQuery(req.query.scope) === "all",
          limit,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/team-catalog", async (req, res, next) => {
    try {
      const search = stringQuery(req.query.search)?.trim() ?? "";
      const limit = numericQuery(req.query.limit, 1, 50);
      res.json(await store.teamCatalog(search, limit));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/favorite-team-watches", async (req, res, next) => {
    try {
      res.json(await store.favoriteTeamWatches(requestClientIdentity(req)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/favorite-team-watches", async (req, res, next) => {
    try {
      const body = z
        .object({
          displayName: z.string().trim().min(2).max(120),
          sourceTeamId: z.string().trim().min(1).max(120).nullable().optional(),
          sourceTeamName: z.string().trim().max(160).nullable().optional(),
          eventName: z.string().trim().max(220).nullable().optional(),
          divisionName: z.string().trim().max(180).nullable().optional(),
          gender: z.string().trim().max(40).nullable().optional(),
          gradeLevel: z.string().trim().max(40).nullable().optional(),
          level: z.string().trim().max(80).nullable().optional(),
          autoFollow: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      res
        .status(201)
        .json(
          await store.saveFavoriteTeamWatch(body, requestClientIdentity(req)),
        );
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/favorite-team-watches/:watchId", async (req, res, next) => {
    try {
      const body = z
        .object({ autoFollow: z.boolean() })
        .strict()
        .parse(req.body ?? {});
      res.json(
        await store.updateFavoriteTeamWatch(
          req.params.watchId,
          body,
          requestClientIdentity(req),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/favorite-team-watches/:watchId", async (req, res, next) => {
    try {
      await store.deleteFavoriteTeamWatch(
        req.params.watchId,
        requestClientIdentity(req),
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/points-leaders", async (req, res, next) => {
    try {
      res.json(
        await store.scoringLeaders(
          requestClientIdentity(req),
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
              requestClientIdentity(req),
            ),
          );
        return;
      }
      res
        .status(201)
        .json(
          await store.followTeam(req.params.teamId, requestClientIdentity(req)),
        );
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/teams/:teamId/follow", async (req, res, next) => {
    try {
      await store.unfollowTeam(req.params.teamId, requestClientIdentity(req));
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
          requestClientIdentity(req),
          requestExposureEventId(req),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/courts", async (req, res, next) => {
    try {
      res.json(await store.courts(requestExposureEventId(req)));
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
          requestClientIdentity(req),
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
        await store.alerts(
          requestClientIdentity(req),
          requestExposureEventId(req),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/push/public-key", (_req, res) => {
    res.json({ vapidPublicKey: config.VAPID_PUBLIC_KEY ?? null });
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
      const clientId = requestClientIdentity(req);
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
      res.status(201).json({
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
      const user = await settingsUser(prismaClient, requestClientIdentity(req));
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
          : await settingsUser(prismaClient, requestClientIdentity(req));
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

  app.post(
    "/api/admin/sync-now",
    adminWriteRateLimit,
    async (req, res, next) => {
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
        const body = z
          .object({ teamListOnly: z.boolean().optional() })
          .passthrough()
          .parse(req.body ?? {});
        const result = await runSync(requestExposureEventId(req), {
          teamListOnly: body.teamListOnly,
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/admin/discover-tournaments",
    adminWriteRateLimit,
    async (req, res, next) => {
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
    },
  );

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

type SyncStreamClient = {
  id: string;
  res: express.Response;
  lastFingerprint: string | null;
  lastHeartbeatAt: number;
};

class SyncStatusStreamBroker {
  private clients = new Map<string, SyncStreamClient>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private latestStatus: Awaited<
    ReturnType<CourtWatchStore["syncStatus"]>
  > | null = null;
  private polling = false;

  constructor(private readonly store: CourtWatchStore) {}

  subscribe(res: express.Response) {
    const client: SyncStreamClient = {
      id: randomUUID(),
      res,
      lastFingerprint: null,
      lastHeartbeatAt: Date.now(),
    };

    this.clients.set(client.id, client);
    if (this.latestStatus) this.sendStatus(client, this.latestStatus);
    this.start();
    void this.poll();

    return () => {
      this.clients.delete(client.id);
      if (this.clients.size === 0) this.stop();
    };
  }

  private start() {
    if (this.interval) return;
    this.interval = setInterval(() => {
      void this.poll();
    }, SYNC_STATUS_STREAM_INTERVAL_MS);
  }

  private stop() {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  }

  private async poll() {
    if (this.polling || this.clients.size === 0) return;
    this.polling = true;
    try {
      const status = await this.store.syncStatus(null, "all");
      this.latestStatus = status;
      const now = Date.now();

      for (const client of this.clients.values()) {
        try {
          if (client.lastFingerprint !== status.fingerprint) {
            this.sendStatus(client, status);
          } else if (
            now - client.lastHeartbeatAt >=
            SYNC_STATUS_STREAM_HEARTBEAT_MS
          ) {
            client.res.write(`: heartbeat ${now}\n\n`);
            client.lastHeartbeatAt = now;
          }
        } catch {
          this.clients.delete(client.id);
        }
      }
    } catch (error) {
      console.warn("Realtime sync-status poll failed; retrying", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.polling = false;
    }
  }

  private sendStatus(
    client: SyncStreamClient,
    status: Awaited<ReturnType<CourtWatchStore["syncStatus"]>>,
  ) {
    client.res.write(`event: sync-status\n`);
    client.res.write(`data: ${JSON.stringify(status)}\n\n`);
    client.lastFingerprint = status.fingerprint;
    client.lastHeartbeatAt = Date.now();
  }
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

function numericQuery(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  const raw = typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(raw)) return undefined;
  return Math.min(max, Math.max(min, Math.trunc(raw)));
}

function countMap(
  values: Array<{ eventId: string; _count: { _all: number } }>,
): Map<string, number> {
  return new Map(values.map((item) => [item.eventId, item._count._all]));
}

function dateOnlyInPacific(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function dateOnlyKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKeyToUtcDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function latestDate(...values: Array<Date | null | undefined>): Date | null {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

function requestClientId(req: express.Request): string | null {
  const headerValue = req.headers["x-courtwatch-client-id"];
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) return null;
  const clientId = raw.trim();
  if (clientId.length < 8 || clientId.length > 160) return null;
  return clientId;
}

function requestClientIdentity(req: express.Request): string | null {
  const session = requestAccountSession(req);
  return session ? accountClientId(session.userId) : requestClientId(req);
}

function requestAccountSession(req: express.Request): {
  userId: string;
  email: string;
} | null {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  return verifyAccountToken(authorization.slice("Bearer ".length).trim());
}

async function requireAdminAccount(
  req: express.Request,
  prismaClient: PrismaClient | null,
): Promise<{ id: string; email: string } | null> {
  const session = requestAccountSession(req);
  if (!session || !prismaClient) return null;
  const user = await prismaClient.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true },
  });
  if (!user?.email) return null;
  return normalizeEmail(user.email) === ADMIN_ACCOUNT_EMAIL
    ? { id: user.id, email: user.email }
    : null;
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
