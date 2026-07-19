import { Prisma, type PrismaClient } from "@courtwatch/db";

const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;
const STALE_RUNNING_SYNC_MS = 15 * 60_000;

export interface ApiHealthOptions {
  databaseConfigured: boolean;
  sourceConfigured: boolean;
  timeoutMs?: number;
}

export interface ApiHealthResult {
  httpStatus: 200 | 503;
  body: {
    ok: boolean;
    status: "ready" | "degraded" | "not_ready";
    timestamp: string;
    checks: {
      database: string;
      source: string;
      operationalMetrics: "ready" | "unavailable";
      synchronization: {
        latestSuccessAt: string | null;
        running: number;
        staleRunning: number;
        failedLastHour: number;
      };
      notifications: {
        pending: number;
        retrying: number;
        deadLetter: number;
      };
    };
  };
}

export async function checkApiReadiness(
  prisma: PrismaClient | null,
  options: ApiHealthOptions,
): Promise<ApiHealthResult> {
  const timestamp = new Date().toISOString();
  const emptyMetrics = {
    synchronization: {
      latestSuccessAt: null,
      running: 0,
      staleRunning: 0,
      failedLastHour: 0,
    },
    notifications: { pending: 0, retrying: 0, deadLetter: 0 },
  };

  if (!options.databaseConfigured) {
    return {
      httpStatus: 200,
      body: {
        ok: true,
        status: "degraded",
        timestamp,
        checks: {
          database: "not_configured",
          source: options.sourceConfigured ? "configured" : "public_fallback",
          operationalMetrics: "unavailable",
          ...emptyMetrics,
        },
      },
    };
  }

  if (!prisma) {
    return notReady(timestamp, options.sourceConfigured, "unavailable");
  }

  const timeoutMs = Math.max(
    250,
    options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
  );
  try {
    await withTimeout(
      prisma.$queryRaw(Prisma.sql`SELECT 1`),
      timeoutMs,
      "database readiness check",
    );
  } catch {
    return notReady(timestamp, options.sourceConfigured, "unavailable");
  }

  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60_000);
    const staleRunningBefore = new Date(now.getTime() - STALE_RUNNING_SYNC_MS);
    const [latestSuccess, running, staleRunning, failedLastHour, queueCounts] =
      await withTimeout(
        Promise.all([
          prisma.syncRun.findFirst({
            where: { status: "success", completedAt: { not: null } },
            orderBy: { completedAt: "desc" },
            select: { completedAt: true },
          }),
          prisma.syncRun.count({ where: { status: "running" } }),
          prisma.syncRun.count({
            where: { status: "running", startedAt: { lt: staleRunningBefore } },
          }),
          prisma.syncRun.count({
            where: { status: "failed", completedAt: { gte: oneHourAgo } },
          }),
          prisma.notificationLog.groupBy({
            by: ["status"],
            where: { status: { in: ["pending", "retrying", "dead_letter"] } },
            _count: { _all: true },
          }),
        ]),
        timeoutMs,
        "operational readiness metrics",
      );
    const queueCount = new Map(
      queueCounts.map((item) => [item.status, item._count._all]),
    );
    const deadLetter = queueCount.get("dead_letter") ?? 0;
    const degraded = staleRunning > 0 || failedLastHour > 0 || deadLetter > 0;

    return {
      httpStatus: 200,
      body: {
        ok: true,
        status: degraded ? "degraded" : "ready",
        timestamp,
        checks: {
          database: "ready",
          source: options.sourceConfigured ? "configured" : "public_fallback",
          operationalMetrics: "ready",
          synchronization: {
            latestSuccessAt: latestSuccess?.completedAt?.toISOString() ?? null,
            running,
            staleRunning,
            failedLastHour,
          },
          notifications: {
            pending: queueCount.get("pending") ?? 0,
            retrying: queueCount.get("retrying") ?? 0,
            deadLetter,
          },
        },
      },
    };
  } catch {
    return {
      httpStatus: 200,
      body: {
        ok: true,
        status: "degraded",
        timestamp,
        checks: {
          database: "ready",
          source: options.sourceConfigured ? "configured" : "public_fallback",
          operationalMetrics: "unavailable",
          ...emptyMetrics,
        },
      },
    };
  }
}

function notReady(
  timestamp: string,
  sourceConfigured: boolean,
  database: string,
): ApiHealthResult {
  return {
    httpStatus: 503,
    body: {
      ok: false,
      status: "not_ready",
      timestamp,
      checks: {
        database,
        source: sourceConfigured ? "configured" : "public_fallback",
        operationalMetrics: "unavailable",
        synchronization: {
          latestSuccessAt: null,
          running: 0,
          staleRunning: 0,
          failedLastHour: 0,
        },
        notifications: { pending: 0, retrying: 0, deadLetter: 0 },
      },
    },
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          timeoutMs,
        );
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
