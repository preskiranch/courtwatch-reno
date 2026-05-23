import { calculatePollDelayMs } from "@courtwatch/core";
import pino from "pino";
import { z } from "zod";

const EnvSchema = z.object({
  API_BASE_URL: z.string().url().default("http://localhost:4000"),
  ADMIN_SECRET: z.string().optional(),
  NODE_ENV: z.string().default("development")
});

const env = EnvSchema.parse(process.env);
const logger = pino({ name: "courtwatch-reno-sync-worker" });
let failureCount = 0;
let shuttingDown = false;

process.on("SIGTERM", () => {
  shuttingDown = true;
  logger.info("received SIGTERM, stopping after current sync");
});

process.on("SIGINT", () => {
  shuttingDown = true;
  logger.info("received SIGINT, stopping after current sync");
});

async function syncOnce() {
  const response = await fetch(new URL("/api/admin/sync-now", env.API_BASE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.ADMIN_SECRET ? { "x-admin-secret": env.ADMIN_SECRET } : {})
    },
    body: JSON.stringify({ source: "worker" })
  });

  if (!response.ok) {
    throw new Error(`sync-now failed with ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<{ status: string; teamsCount: number; gamesCount: number; changesDetected: number }>;
}

async function loop() {
  while (!shuttingDown) {
    try {
      const result = await syncOnce();
      failureCount = 0;
      logger.info(result, "sync completed");
    } catch (error) {
      failureCount += 1;
      logger.error({ error: error instanceof Error ? error.message : error, failureCount }, "sync failed");
    }

    const delay = calculatePollDelayMs({ failureCount });
    logger.info({ delayMs: delay, failureCount }, "waiting for next sync");
    await sleep(delay);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

logger.info({ apiBaseUrl: env.API_BASE_URL }, "starting worker");
void loop();
