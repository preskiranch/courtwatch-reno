import type { PrismaClient } from "@courtwatch/db";

export const INTERRUPTED_SYNC_ERROR =
  "Sync interrupted before completion; recovered during API startup.";

export async function recoverInterruptedSyncRuns(
  prisma: PrismaClient,
  staleAfterMs: number,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - Math.max(60_000, staleAfterMs));
  const result = await prisma.syncRun.updateMany({
    where: {
      status: "running",
      startedAt: { lt: cutoff },
    },
    data: {
      status: "failed",
      completedAt: now,
      errorMessage: INTERRUPTED_SYNC_ERROR,
    },
  });
  return result.count;
}
