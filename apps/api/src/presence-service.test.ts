import { describe, expect, it } from "vitest";
import { type PresenceStore, PresenceService } from "./presence-service.js";

class SharedPresenceStore implements PresenceStore {
  readonly entries = new Map<
    string,
    { page: string | null; lastSeenAt: Date }
  >();

  async upsert(clientId: string, page: string | null, now: Date) {
    this.entries.set(clientId, { page, lastSeenAt: now });
  }

  async countSince(cutoff: Date) {
    return this.active(cutoff).length;
  }

  async countByPageSince(cutoff: Date) {
    const counts = new Map<string | null, number>();
    for (const entry of this.active(cutoff)) {
      counts.set(entry.page, (counts.get(entry.page) ?? 0) + 1);
    }
    return Array.from(counts, ([page, count]) => ({ page, count }));
  }

  async deleteOlderThan(cutoff: Date) {
    for (const [clientId, entry] of this.entries) {
      if (entry.lastSeenAt < cutoff) this.entries.delete(clientId);
    }
  }

  private active(cutoff: Date) {
    return Array.from(this.entries.values()).filter(
      (entry) => entry.lastSeenAt >= cutoff,
    );
  }
}

describe("PresenceService", () => {
  it("shares active presence between API instances", async () => {
    const store = new SharedPresenceStore();
    const first = new PresenceService(store, 45_000);
    const second = new PresenceService(store, 45_000);
    const now = new Date("2026-07-18T12:00:00.000Z");

    await first.heartbeat("client-one", "dashboard", now);
    await second.heartbeat("client-two", "schedule", now);
    const snapshot = await first.snapshot(now);

    expect(snapshot).toMatchObject({
      activeUsers: 2,
      pages: { dashboard: 1, schedule: 1 },
      source: "database",
      degraded: false,
    });
  });

  it("expires stale presence without depending on cleanup", async () => {
    const store = new SharedPresenceStore();
    const service = new PresenceService(store, 45_000);
    const startedAt = new Date("2026-07-18T12:00:00.000Z");

    await service.heartbeat("stale-client", "teams", startedAt);
    const snapshot = await service.snapshot(
      new Date(startedAt.getTime() + 45_001),
    );

    expect(snapshot.activeUsers).toBe(0);
    expect(snapshot.pages).toEqual({});
  });

  it("fails open to local memory when shared storage is unavailable", async () => {
    const unavailable: PresenceStore = {
      upsert: async () => {
        throw new Error("database unavailable");
      },
      countSince: async () => {
        throw new Error("database unavailable");
      },
      countByPageSince: async () => {
        throw new Error("database unavailable");
      },
      deleteOlderThan: async () => {
        throw new Error("database unavailable");
      },
    };
    const service = new PresenceService(unavailable, 45_000);

    const result = await service.heartbeat(
      "fallback-client",
      "alerts",
      new Date("2026-07-18T12:00:00.000Z"),
    );

    expect(result).toMatchObject({
      activeUsers: 1,
      pages: { alerts: 1 },
      source: "memory",
      degraded: true,
    });
  });
});
