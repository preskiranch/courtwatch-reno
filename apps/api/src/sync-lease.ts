import { Prisma, type PrismaClient } from "@courtwatch/db";
import { randomUUID } from "node:crypto";

const DEFAULT_LEASE_TTL_MS = 120_000;
const DEFAULT_LEASE_WAIT_MS = 8_000;
const MIN_LEASE_TTL_MS = 30_000;

export interface SyncLeaseHandle {
  key: string;
  ownerId: string;
  release(): Promise<void>;
}

interface SyncLeaseOptions {
  ttlMs?: number;
  waitMs?: number;
  pollMs?: number;
  onHeartbeatError?: (error: unknown) => void;
}

export async function acquireSyncLease(
  prisma: PrismaClient,
  key: string,
  options: SyncLeaseOptions = {},
): Promise<SyncLeaseHandle | null> {
  const ttlMs = Math.max(
    MIN_LEASE_TTL_MS,
    options.ttlMs ?? envNumber("SYNC_LEASE_TTL_MS", DEFAULT_LEASE_TTL_MS),
  );
  const waitMs = Math.max(
    0,
    options.waitMs ?? envNumber("SYNC_LEASE_WAIT_MS", DEFAULT_LEASE_WAIT_MS),
  );
  const pollMs = Math.max(100, options.pollMs ?? 300);
  const ownerId = randomUUID();
  const deadline = Date.now() + waitMs;

  while (true) {
    if (await tryClaimLease(prisma, key, ownerId, ttlMs)) {
      return startLeaseHeartbeat(
        prisma,
        key,
        ownerId,
        ttlMs,
        options.onHeartbeatError,
      );
    }
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
}

async function tryClaimLease(
  prisma: PrismaClient,
  key: string,
  ownerId: string,
  ttlMs: number,
): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const updated = await prisma.syncLease.updateMany({
    where: {
      key,
      OR: [{ expiresAt: { lte: now } }, { ownerId }],
    },
    data: { ownerId, acquiredAt: now, expiresAt },
  });
  if (updated.count > 0) return true;

  try {
    await prisma.syncLease.create({
      data: { key, ownerId, acquiredAt: now, expiresAt },
    });
    return true;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return false;
    }
    throw error;
  }
}

function startLeaseHeartbeat(
  prisma: PrismaClient,
  key: string,
  ownerId: string,
  ttlMs: number,
  onHeartbeatError?: (error: unknown) => void,
): SyncLeaseHandle {
  let released = false;
  const heartbeatMs = Math.max(5_000, Math.floor(ttlMs / 3));
  const heartbeat = setInterval(() => {
    const now = new Date();
    void prisma.syncLease
      .updateMany({
        where: { key, ownerId },
        data: { expiresAt: new Date(now.getTime() + ttlMs) },
      })
      .then((result) => {
        if (result.count === 0) {
          onHeartbeatError?.(new Error(`Sync lease ${key} was lost`));
        }
      })
      .catch((error: unknown) => onHeartbeatError?.(error));
  }, heartbeatMs);
  heartbeat.unref?.();

  return {
    key,
    ownerId,
    async release() {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      await prisma.syncLease.deleteMany({ where: { key, ownerId } });
    },
  };
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
