import type { PrismaClient } from "@courtwatch/db";
import { describe, expect, it, vi } from "vitest";
import {
  accountClientId,
  hashPassword,
  sendPasswordResetEmail,
  shouldExposeResetToken,
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

  it("does not crash password reset email when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const result = await sendPasswordResetEmail({
      email: "family@example.com",
      resetToken: "reset-token-1234567890",
    });

    expect(result).toMatchObject({
      configured: false,
      sent: false,
      from: "Court Watch AAU <no-reply@courtwatchaau.com>",
    });
    expect(result.resetUrl).toContain("resetToken=reset-token-1234567890");
  });

  it("never exposes password reset tokens in production", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalExposeToken = process.env.PASSWORD_RESET_EXPOSE_TOKEN;
    const originalWebBaseUrl = process.env.WEB_BASE_URL;

    process.env.NODE_ENV = "production";
    process.env.PASSWORD_RESET_EXPOSE_TOKEN = "true";
    process.env.WEB_BASE_URL = "https://courtwatchaau.com";
    expect(shouldExposeResetToken()).toBe(false);

    process.env.NODE_ENV = "development";
    expect(shouldExposeResetToken()).toBe(false);

    process.env.WEB_BASE_URL = "http://localhost:3000";
    expect(shouldExposeResetToken()).toBe(true);

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalExposeToken === undefined) {
      delete process.env.PASSWORD_RESET_EXPOSE_TOKEN;
    } else {
      process.env.PASSWORD_RESET_EXPOSE_TOKEN = originalExposeToken;
    }
    if (originalWebBaseUrl === undefined) {
      delete process.env.WEB_BASE_URL;
    } else {
      process.env.WEB_BASE_URL = originalWebBaseUrl;
    }
  });

  it("sends password reset email through Resend with the Court Watch domain", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.WEB_BASE_URL = "https://courtwatchaau.com";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendPasswordResetEmail({
      email: "family@example.com",
      resetToken: "reset-token-1234567890",
    });

    expect(result).toMatchObject({
      configured: true,
      sent: true,
      messageId: "email_123",
      from: "Court Watch AAU <no-reply@courtwatchaau.com>",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_key",
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      from: string;
      html: string;
      text: string;
      to: string;
    };
    expect(body.from).toBe("Court Watch AAU <no-reply@courtwatchaau.com>");
    expect(body.to).toBe("family@example.com");
    expect(body.text).toContain("https://courtwatchaau.com/?resetToken=");
    expect(body.html).toContain("Reset password");

    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.WEB_BASE_URL;
  });
});
