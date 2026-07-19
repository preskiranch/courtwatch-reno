import { Prisma, type PrismaClient } from "@courtwatch/db";
import { describe, expect, it } from "vitest";
import { acquireSyncLease } from "./sync-lease.js";

describe("database sync lease", () => {
  it("allows one owner at a time and releases ownership", async () => {
    const prisma = fakeLeasePrisma();
    const first = await acquireSyncLease(prisma, "event:255539", {
      waitMs: 0,
    });
    expect(first).not.toBeNull();

    const blocked = await acquireSyncLease(prisma, "event:255539", {
      waitMs: 0,
    });
    expect(blocked).toBeNull();

    await first!.release();
    await first!.release();

    const next = await acquireSyncLease(prisma, "event:255539", {
      waitMs: 0,
    });
    expect(next).not.toBeNull();
    await next!.release();
  });

  it("reclaims an expired lease after an interrupted process", async () => {
    const prisma = fakeLeasePrisma({
      key: "event:255539",
      ownerId: "dead-process",
      acquiredAt: new Date(0),
      expiresAt: new Date(0),
    });

    const lease = await acquireSyncLease(prisma, "event:255539", {
      waitMs: 0,
    });
    expect(lease).not.toBeNull();
    expect(lease!.ownerId).not.toBe("dead-process");
    await lease!.release();
  });
});

type LeaseRecord = {
  key: string;
  ownerId: string;
  acquiredAt: Date;
  expiresAt: Date;
};

function fakeLeasePrisma(initial?: LeaseRecord): PrismaClient {
  let record = initial;
  const syncLease = {
    async updateMany(args: {
      where: { key: string; OR?: unknown; ownerId?: string };
      data: Partial<LeaseRecord>;
    }) {
      if (!record || record.key !== args.where.key) return { count: 0 };
      const canClaim = args.where.OR
        ? record.expiresAt <= new Date() ||
          record.ownerId === args.data.ownerId
        : record.ownerId === args.where.ownerId;
      if (!canClaim) return { count: 0 };
      record = { ...record, ...args.data };
      return { count: 1 };
    },
    async create(args: { data: LeaseRecord }) {
      if (record) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate lease", {
          code: "P2002",
          clientVersion: "test",
        });
      }
      record = args.data;
      return record;
    },
    async deleteMany(args: { where: { key: string; ownerId: string } }) {
      if (
        record?.key === args.where.key &&
        record.ownerId === args.where.ownerId
      ) {
        record = undefined;
        return { count: 1 };
      }
      return { count: 0 };
    },
  };
  return { syncLease } as unknown as PrismaClient;
}
