import type { PrismaClient } from "@courtwatch/db";

export type PresencePayload = {
  activeUsers: number;
  pages: Record<string, number>;
  clientId: string | null;
  updatedAt: string;
  source: "database" | "memory";
  degraded: boolean;
};

export interface PresenceStore {
  upsert(clientId: string, page: string | null, now: Date): Promise<void>;
  countSince(cutoff: Date): Promise<number>;
  countByPageSince(
    cutoff: Date,
  ): Promise<Array<{ page: string | null; count: number }>>;
  deleteOlderThan(cutoff: Date): Promise<void>;
}

export class PrismaPresenceStore implements PresenceStore {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(clientId: string, page: string | null, now: Date) {
    await this.prisma.presenceSession.upsert({
      where: { clientId },
      create: { clientId, page, lastSeenAt: now },
      update: { page, lastSeenAt: now },
    });
  }

  async countSince(cutoff: Date) {
    return this.prisma.presenceSession.count({
      where: { lastSeenAt: { gte: cutoff } },
    });
  }

  async countByPageSince(cutoff: Date) {
    const groups = await this.prisma.presenceSession.groupBy({
      by: ["page"],
      where: { lastSeenAt: { gte: cutoff } },
      _count: { _all: true },
    });
    return groups.map((group) => ({
      page: group.page,
      count: group._count._all,
    }));
  }

  async deleteOlderThan(cutoff: Date) {
    await this.prisma.presenceSession.deleteMany({
      where: { lastSeenAt: { lt: cutoff } },
    });
  }
}

export class PresenceService {
  private readonly memory = new Map<
    string,
    { lastSeenAt: number; page: string | null }
  >();
  private nextDatabaseCleanupAt = 0;

  constructor(
    private readonly store: PresenceStore | null,
    private readonly ttlMs = 45_000,
    private readonly cleanupIntervalMs = 60_000,
  ) {}

  async heartbeat(
    clientId: string,
    page: string | null,
    now = new Date(),
  ): Promise<PresencePayload> {
    this.memory.set(clientId, { lastSeenAt: now.getTime(), page });

    if (this.store) {
      try {
        await this.store.upsert(clientId, page, now);
        await this.cleanupDatabaseIfDue(now);
        return await this.databasePayload(clientId, now);
      } catch {
        return this.memoryPayload(clientId, now, true);
      }
    }

    return this.memoryPayload(clientId, now, false);
  }

  async snapshot(now = new Date()): Promise<PresencePayload> {
    if (this.store) {
      try {
        return await this.databasePayload(null, now);
      } catch {
        return this.memoryPayload(null, now, true);
      }
    }

    return this.memoryPayload(null, now, false);
  }

  private async databasePayload(
    clientId: string | null,
    now: Date,
  ): Promise<PresencePayload> {
    const cutoff = new Date(now.getTime() - this.ttlMs);
    const [activeUsers, pageGroups] = await Promise.all([
      this.store!.countSince(cutoff),
      this.store!.countByPageSince(cutoff),
    ]);
    return {
      activeUsers,
      pages: pageGroups.reduce<Record<string, number>>((pages, group) => {
        pages[group.page ?? "unknown"] = group.count;
        return pages;
      }, {}),
      clientId,
      updatedAt: now.toISOString(),
      source: "database",
      degraded: false,
    };
  }

  private memoryPayload(
    clientId: string | null,
    now: Date,
    degraded: boolean,
  ): PresencePayload {
    this.pruneMemory(now.getTime());
    const pages = Array.from(this.memory.values()).reduce<
      Record<string, number>
    >((counts, presence) => {
      const key = presence.page ?? "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    return {
      activeUsers: this.memory.size,
      pages,
      clientId,
      updatedAt: now.toISOString(),
      source: "memory",
      degraded,
    };
  }

  private pruneMemory(nowMs: number) {
    for (const [clientId, presence] of this.memory.entries()) {
      if (nowMs - presence.lastSeenAt > this.ttlMs)
        this.memory.delete(clientId);
    }
  }

  private async cleanupDatabaseIfDue(now: Date) {
    if (now.getTime() < this.nextDatabaseCleanupAt) return;
    this.nextDatabaseCleanupAt = now.getTime() + this.cleanupIntervalMs;
    await this.store!.deleteOlderThan(new Date(now.getTime() - this.ttlMs));
  }
}

export function createPresenceService(
  prisma: PrismaClient | null,
  ttlMs = 45_000,
) {
  return new PresenceService(
    prisma ? new PrismaPresenceStore(prisma) : null,
    ttlMs,
  );
}
