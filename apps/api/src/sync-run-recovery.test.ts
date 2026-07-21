import type { PrismaClient } from "@courtwatch/db";
import { describe, expect, it, vi } from "vitest";
import {
  INTERRUPTED_SYNC_ERROR,
  recoverInterruptedSyncRuns,
} from "./sync-run-recovery.js";

describe("recoverInterruptedSyncRuns", () => {
  it("closes only sync runs that were abandoned before the stale cutoff", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const prisma = { syncRun: { updateMany } } as unknown as PrismaClient;
    const now = new Date("2026-07-21T18:00:00.000Z");

    await expect(
      recoverInterruptedSyncRuns(prisma, 15 * 60_000, now),
    ).resolves.toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: "running",
        startedAt: { lt: new Date("2026-07-21T17:45:00.000Z") },
      },
      data: {
        status: "failed",
        completedAt: now,
        errorMessage: INTERRUPTED_SYNC_ERROR,
      },
    });
  });
});
