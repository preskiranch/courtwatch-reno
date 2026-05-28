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
}): Promise<boolean> {
  if (!config.RESEND_API_KEY || !config.PASSWORD_RESET_FROM_EMAIL) return false;
  const resetUrl = `${config.WEB_BASE_URL}/?resetToken=${encodeURIComponent(
    input.resetToken,
  )}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.PASSWORD_RESET_FROM_EMAIL,
      to: input.email,
      subject: "Court Watch AAU password reset",
      text: [
        "Use this Court Watch AAU reset code within 60 minutes:",
        "",
        input.resetToken,
        "",
        `Open Court Watch AAU and paste the code in Forgot Password. You can also open ${resetUrl}`,
      ].join("\n"),
    }),
  });
  return response.ok;
}

export function shouldExposeResetToken(): boolean {
  return (
    config.PASSWORD_RESET_EXPOSE_TOKEN ||
    (process.env.NODE_ENV ?? config.NODE_ENV) !== "production"
  );
}

export async function registeredAccountCount(
  prismaClient: PrismaClient | null,
): Promise<number> {
  if (!prismaClient) return 0;
  return prismaClient.user.count({
    where: { email: { not: null }, passwordHash: { not: null } },
  });
}

function authSecret(): string {
  const secret = process.env.JWT_SECRET ?? config.JWT_SECRET;
  if (secret) return secret;
  if ((process.env.NODE_ENV ?? config.NODE_ENV) !== "production")
    return "courtwatch-dev-auth-secret";
  throw new Error("JWT_SECRET is required for account sessions");
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
