import type { PrismaClient } from "@courtwatch/db";
import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { config } from "./config.js";

const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 32;
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const DEFAULT_PASSWORD_RESET_FROM_EMAIL =
  "Court Watch AAU <no-reply@courtwatchaau.com>";

export type PasswordResetEmailResult = {
  configured: boolean;
  sent: boolean;
  resetUrl: string;
  from: string;
  messageId?: string;
  status?: number;
  error?: string;
};

export type AccountUser = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
};

type AccountTokenPayload = {
  sub: string;
  email: string;
  exp: number;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function accountClientId(userId: string): string {
  return `account:${userId}`;
}

export function publicAccountUser(user: {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: Date;
}): AccountUser {
  return {
    id: user.id,
    email: user.email ?? "",
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(
    password,
    salt,
    PASSWORD_ITERATIONS,
    PASSWORD_KEY_LENGTH,
    "sha256",
  ).toString("base64url");
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [algorithm, iterationsText, salt, expectedHash] = storedHash.split("$");
  if (
    algorithm !== "pbkdf2_sha256" ||
    !iterationsText ||
    !salt ||
    !expectedHash
  )
    return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const actual = pbkdf2Sync(
    password,
    salt,
    iterations,
    Buffer.from(expectedHash, "base64url").length,
    "sha256",
  );
  const expected = Buffer.from(expectedHash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function signAccountToken(user: {
  id: string;
  email: string | null;
}): string {
  if (!user.email) throw new Error("Account email is required");
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: AccountTokenPayload = {
    sub: user.id,
    email: user.email,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = base64UrlJson(payload);
  const signature = createHmac("sha256", authSecret())
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyAccountToken(token: string | null | undefined): {
  userId: string;
  email: string;
} | null {
  if (!token) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  const expectedSignature = createHmac("sha256", authSecret())
    .update(encodedPayload)
    .digest("base64url");
  const actual = Buffer.from(signature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  const payload = parsePayload(encodedPayload);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return { userId: payload.sub, email: payload.email };
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createResetToken(): string {
  return randomBytes(24).toString("base64url");
}

export function resetTokenExpiresAt(): Date {
  return new Date(Date.now() + RESET_TOKEN_TTL_MS);
}

export async function sendPasswordResetEmail(input: {
  email: string;
  resetToken: string;
}): Promise<PasswordResetEmailResult> {
  const resendApiKey =
    nonEmptyString(process.env.RESEND_API_KEY) ?? config.RESEND_API_KEY;
  const from =
    nonEmptyString(process.env.PASSWORD_RESET_FROM_EMAIL) ??
    nonEmptyString(config.PASSWORD_RESET_FROM_EMAIL) ??
    DEFAULT_PASSWORD_RESET_FROM_EMAIL;
  const webBaseUrl =
    nonEmptyString(process.env.WEB_BASE_URL) ??
    nonEmptyString(config.WEB_BASE_URL) ??
    "https://courtwatchaau.com";
  const resetUrl = `${webBaseUrl}/?resetToken=${encodeURIComponent(
    input.resetToken,
  )}`;
  if (!resendApiKey) return { configured: false, sent: false, resetUrl, from };

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.email,
        subject: "Court Watch AAU password reset",
        text: [
          "Reset your Court Watch AAU password",
          "",
          "Use this secure reset link within 60 minutes:",
          "",
          resetUrl,
          "",
          "If the button does not open, copy the reset code below and paste it in Forgot Password:",
          "",
          input.resetToken,
          "",
          "If you did not request this reset, you can ignore this email.",
        ].join("\n"),
        html: passwordResetEmailHtml(resetUrl, input.resetToken),
      }),
    });
  } catch (error) {
    return {
      configured: true,
      sent: false,
      resetUrl,
      from,
      error: error instanceof Error ? error.message : "Resend request failed",
    };
  }

  const payload = await readResendResponse(response);
  if (!response.ok) {
    return {
      configured: true,
      sent: false,
      resetUrl,
      from,
      status: response.status,
      error: payload.error,
    };
  }
  return {
    configured: true,
    sent: true,
    resetUrl,
    from,
    status: response.status,
    messageId: payload.id,
  };
}

export function shouldExposeResetToken(): boolean {
  const exposeToken =
    process.env.PASSWORD_RESET_EXPOSE_TOKEN !== undefined
      ? process.env.PASSWORD_RESET_EXPOSE_TOKEN.toLowerCase() === "true"
      : config.PASSWORD_RESET_EXPOSE_TOKEN;
  return exposeToken && isLocalPasswordResetDebug();
}

export async function registeredAccountCount(
  prismaClient: PrismaClient | null,
): Promise<number> {
  if (!prismaClient) return 0;
  return prismaClient.user.count({
    where: { email: { not: null }, passwordHash: { not: null } },
  });
}

export async function unregisteredFollowerDeviceCount(
  prismaClient: PrismaClient | null,
): Promise<number> {
  if (!prismaClient) return 0;
  return prismaClient.user.count({
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
}

function authSecret(): string {
  const secret = process.env.JWT_SECRET ?? config.JWT_SECRET;
  if (secret) return secret;
  if ((process.env.NODE_ENV ?? config.NODE_ENV) !== "production")
    return "courtwatch-dev-auth-secret";
  throw new Error("JWT_SECRET is required for account sessions");
}

function isLocalPasswordResetDebug(): boolean {
  const webBaseUrl = process.env.WEB_BASE_URL ?? config.WEB_BASE_URL;
  if (!webBaseUrl) return false;
  try {
    const hostname = new URL(webBaseUrl).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function nonEmptyString(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function readResendResponse(
  response: Response,
): Promise<{ id?: string; error?: string }> {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as {
      id?: unknown;
      name?: unknown;
      message?: unknown;
      error?: unknown;
    };
    const id = typeof parsed.id === "string" ? parsed.id : undefined;
    const error =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.error === "string"
          ? parsed.error
          : typeof parsed.name === "string"
            ? parsed.name
            : undefined;
    return { id, error };
  } catch {
    return { error: text.slice(0, 500) };
  }
}

function passwordResetEmailHtml(resetUrl: string, resetToken: string): string {
  const escapedResetUrl = escapeHtml(resetUrl);
  const escapedResetToken = escapeHtml(resetToken);
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#0b1726;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#101828;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;padding:24px;color:#ffffff;">
        <div style="font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#fb923c;">Court Watch AAU</div>
        <h1 style="margin:10px 0 0;font-size:26px;line-height:1.15;">Reset your password</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#334155;">Use the button below within 60 minutes to reset your Court Watch AAU password.</p>
        <a href="${escapedResetUrl}" style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;font-weight:800;border-radius:10px;padding:13px 18px;">Reset password</a>
        <p style="margin:22px 0 8px;font-size:13px;line-height:1.5;color:#64748b;">If the button does not open, paste this reset code in Forgot Password:</p>
        <div style="word-break:break-all;background:#f1f5f9;border-radius:10px;padding:12px;font-size:14px;font-weight:700;color:#0f172a;">${escapedResetToken}</div>
        <p style="margin:22px 0 0;font-size:13px;line-height:1.5;color:#64748b;">If you did not request this reset, you can ignore this email.</p>
      </div>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parsePayload(encodedPayload: string): AccountTokenPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<AccountTokenPayload>;
    if (
      typeof parsed.sub !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.exp !== "number"
    )
      return null;
    return { sub: parsed.sub, email: parsed.email, exp: parsed.exp };
  } catch {
    return null;
  }
}
