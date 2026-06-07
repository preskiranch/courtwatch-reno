import type { PrismaClient } from "@courtwatch/db";
import { describe, expect, it, vi } from "vitest";
import {
  accountClientId,
  hashPassword,
  signAccountToken,
  unregisteredFollowerDeviceCount,
  verifyAccountToken,
  verifyPassword,
} from "./auth.js";

describe("account auth helpers", () => {
  it("hashes passwords without storing the original password", () => {
    const hash = hashPassword("safe-password-123");

    expect(hash).not.toContain("safe-password-123");
    expect(verifyPassword("safe-password-123", hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("signs account tokens that resolve to account-scoped client ids", () => {
    process.env.JWT_SECRET = "unit-test-secret";
    const token = signAccountToken({
      id: "user-test-1",
      email: "family@example.com",
    });
    const session = verifyAccountToken(token);

    expect(session).toEqual({
      userId: "user-test-1",
      email: "family@example.com",
    });
    expect(accountClientId(session?.userId ?? "")).toBe("account:user-test-1");
    delete process.env.JWT_SECRET;
  });

  it("counts anonymous devices that have followed at least one team", async () => {
    const count = vi.fn().mockResolvedValue(42);
    const prisma = { user: { count } } as unknown as PrismaClient;

    await expect(unregisteredFollowerDeviceCount(prisma)).resolves.toBe(42);
    expect(count).toHaveBeenCalledWith({
      where: {
        email: null,
        clientId: { not: null },
        watchlists: {
          some: {
            matches: { some: {} },
          },
        },
      },
    });
  });
});
