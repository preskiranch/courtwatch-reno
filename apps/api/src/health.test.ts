import type { PrismaClient } from "@courtwatch/db";
import { describe, expect, it, vi } from "vitest";
import { checkApiReadiness } from "./health.js";

describe("API readiness", () => {
  it("reports queue and synchronization degradation without failing readiness", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
      syncRun: {
        findFirst: vi.fn().mockResolvedValue({
          completedAt: new Date("2026-07-18T12:00:00.000Z"),
        }),
        count: vi
          .fn()
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(2),
      },
      notificationLog: {
        groupBy: vi.fn().mockResolvedValue([
          { status: "pending", _count: { _all: 3 } },
          { status: "dead_letter", _count: { _all: 1 } },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await checkApiReadiness(prisma, {
      databaseConfigured: true,
      sourceConfigured: false,
    });

    expect(result.httpStatus).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      status: "degraded",
      checks: {
        database: "ready",
        source: "public_fallback",
        operationalMetrics: "ready",
        synchronization: {
          running: 1,
          staleRunning: 1,
          failedLastHour: 2,
        },
        notifications: { pending: 3, retrying: 0, deadLetter: 1 },
      },
    });
  });

  it("fails readiness when the configured database is unavailable", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error("connection refused")),
    } as unknown as PrismaClient;

    const result = await checkApiReadiness(prisma, {
      databaseConfigured: true,
      sourceConfigured: true,
    });

    expect(result.httpStatus).toBe(503);
    expect(result.body).toMatchObject({
      ok: false,
      status: "not_ready",
      checks: { database: "unavailable" },
    });
  });

  it("keeps serving when optional operational metrics are unavailable", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
      syncRun: {
        findFirst: vi.fn().mockRejectedValue(new Error("metrics unavailable")),
        count: vi.fn(),
      },
      notificationLog: { groupBy: vi.fn() },
    } as unknown as PrismaClient;

    const result = await checkApiReadiness(prisma, {
      databaseConfigured: true,
      sourceConfigured: true,
    });

    expect(result.httpStatus).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      status: "degraded",
      checks: { database: "ready", operationalMetrics: "unavailable" },
    });
  });
});
